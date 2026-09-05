"""Master data CRUD: roles (read), departments, users, projects, units."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from kernel.identity.auth_utils import (
    get_current_user,
    require_super_admin,
)
from kernel.mongo import get_db, sanitize, utcnow_iso, write_audit
from models import (
    Department,
    DepartmentCreate,
    DepartmentUpdate,
    Project,
    ProjectCreate,
    ProjectUpdate,
    Unit,
    UnitCreate,
    UnitUpdate,
    UserCreate,
    UserOut,
    UserUpdate,
)


router = APIRouter(tags=["master"])


# ---------------- Roles (read-only) ----------------

@router.get("/roles")
async def list_roles(current_user: dict = Depends(get_current_user)):
    db = get_db()
    docs = await db.roles.find({}, {"_id": 0}).sort("name", 1).to_list(100)
    return docs


# ---------------- Departments ----------------

@router.get("/departments")
async def list_departments(
    include_inactive: bool = Query(False),
    current_user: dict = Depends(get_current_user),
):
    db = get_db()
    q = {} if include_inactive else {"active": True}
    return await db.departments.find(q, {"_id": 0}).sort("name", 1).to_list(500)


@router.post("/departments", response_model=Department)
async def create_department(
    payload: DepartmentCreate,
    current_user: dict = Depends(require_super_admin()),
):
    db = get_db()
    if await db.departments.find_one({"code": payload.code}):
        raise HTTPException(status_code=409, detail="Department code already exists")
    dept = Department(**payload.model_dump())
    await db.departments.insert_one(dept.model_dump())
    await write_audit(
        user_id=current_user["id"],
        entity_type="department",
        entity_id=dept.id,
        action="create",
        after=dept.model_dump(),
    )
    return dept


@router.put("/departments/{dept_id}", response_model=Department)
async def update_department(
    dept_id: str,
    payload: DepartmentUpdate,
    current_user: dict = Depends(require_super_admin()),
):
    db = get_db()
    before = await db.departments.find_one({"id": dept_id}, {"_id": 0})
    if not before:
        raise HTTPException(status_code=404, detail="Department not found")
    changes = payload.model_dump(exclude_unset=True)
    if not changes:
        return Department(**before)
    if "code" in changes and changes["code"] != before["code"]:
        if await db.departments.find_one({"code": changes["code"]}):
            raise HTTPException(status_code=409, detail="Department code already exists")
    changes["updated_at"] = utcnow_iso()
    await db.departments.update_one({"id": dept_id}, {"$set": changes})
    after = await db.departments.find_one({"id": dept_id}, {"_id": 0})
    await write_audit(
        user_id=current_user["id"],
        entity_type="department",
        entity_id=dept_id,
        action="update",
        before=before,
        after=after,
    )
    return Department(**after)


@router.delete("/departments/{dept_id}")
async def delete_department(
    dept_id: str,
    current_user: dict = Depends(require_super_admin()),
):
    db = get_db()
    before = await db.departments.find_one({"id": dept_id}, {"_id": 0})
    if not before:
        raise HTTPException(status_code=404, detail="Department not found")
    await db.departments.update_one(
        {"id": dept_id}, {"$set": {"active": False, "updated_at": utcnow_iso()}}
    )
    after = await db.departments.find_one({"id": dept_id}, {"_id": 0})
    await write_audit(
        user_id=current_user["id"],
        entity_type="department",
        entity_id=dept_id,
        action="delete",
        before=before,
        after=after,
    )
    return {"ok": True}


# ---------------- Users ----------------

def _user_out(doc: dict) -> dict:
    doc = sanitize(doc)
    doc.pop("password_hash", None)
    doc.setdefault("assigned_project_ids", [])
    return doc


@router.get("/users")
async def list_users(
    include_inactive: bool = Query(False),
    current_user: dict = Depends(require_super_admin()),
):
    db = get_db()
    q = {} if include_inactive else {"active": True}
    docs = await db.users.find(q, {"_id": 0, "password_hash": 0}).sort("name", 1).to_list(500)
    return docs


@router.get("/users/assignable")
async def list_assignable_users(
    role_code: Optional[str] = None,
    current_user: dict = Depends(get_current_user),
):
    """Any authenticated user can list active users for owner-selection dropdowns."""
    db = get_db()
    q = {"active": True}
    if role_code:
        role = await db.roles.find_one({"code": role_code})
        if role:
            q["role_id"] = role["id"]
    docs = await db.users.find(q, {"_id": 0, "password_hash": 0}).sort("name", 1).to_list(500)
    return docs


@router.post("/users", response_model=UserOut)
async def create_user(
    payload: UserCreate,
    current_user: dict = Depends(require_super_admin()),
):
    db = get_db()
    email = payload.email.lower()
    if await db.users.find_one({"email": email}):
        raise HTTPException(status_code=409, detail="Email already exists")
    if not await db.roles.find_one({"id": payload.role_id}):
        raise HTTPException(status_code=400, detail="Invalid role_id")
    if payload.department_id and not await db.departments.find_one({"id": payload.department_id}):
        raise HTTPException(status_code=400, detail="Invalid department_id")
    if payload.manager_id and not await db.users.find_one({"id": payload.manager_id}):
        raise HTTPException(status_code=400, detail="Invalid manager_id")

    import uuid as _u
    doc = {
        "id": str(_u.uuid4()),
        "email": email,
        "name": payload.name,
        "phone": payload.phone,
        "role_id": payload.role_id,
        "department_id": payload.department_id,
        "manager_id": payload.manager_id,
        "active": payload.active,
        "assigned_project_ids": list(payload.assigned_project_ids or []),
        "created_at": utcnow_iso(),
        "updated_at": utcnow_iso(),
    }
    await db.users.insert_one(doc)
    after = _user_out(doc)
    await write_audit(
        user_id=current_user["id"],
        entity_type="user",
        entity_id=doc["id"],
        action="create",
        after=after,
    )
    return after


@router.put("/users/{user_id}", response_model=UserOut)
async def update_user(
    user_id: str,
    payload: UserUpdate,
    current_user: dict = Depends(require_super_admin()),
):
    db = get_db()
    before_full = await db.users.find_one({"id": user_id}, {"_id": 0})
    if not before_full:
        raise HTTPException(status_code=404, detail="User not found")
    changes = payload.model_dump(exclude_unset=True)
    if "email" in changes:
        changes["email"] = changes["email"].lower()
        if changes["email"] != before_full["email"]:
            if await db.users.find_one({"email": changes["email"]}):
                raise HTTPException(status_code=409, detail="Email already exists")
    # No passwords: identity is Google OIDC / OTP + the session row (technical/03).
    changes.pop("password", None)
    if "role_id" in changes and not await db.roles.find_one({"id": changes["role_id"]}):
        raise HTTPException(status_code=400, detail="Invalid role_id")
    if "department_id" in changes and changes["department_id"]:
        if not await db.departments.find_one({"id": changes["department_id"]}):
            raise HTTPException(status_code=400, detail="Invalid department_id")
    if "manager_id" in changes and changes["manager_id"]:
        if not await db.users.find_one({"id": changes["manager_id"]}):
            raise HTTPException(status_code=400, detail="Invalid manager_id")
    changes["updated_at"] = utcnow_iso()
    await db.users.update_one({"id": user_id}, {"$set": changes})
    after_full = await db.users.find_one({"id": user_id}, {"_id": 0})
    await write_audit(
        user_id=current_user["id"],
        entity_type="user",
        entity_id=user_id,
        action="update",
        before=_user_out(before_full),
        after=_user_out(after_full),
    )
    return _user_out(after_full)


@router.delete("/users/{user_id}")
async def deactivate_user(
    user_id: str,
    current_user: dict = Depends(require_super_admin()),
):
    if user_id == current_user["id"]:
        raise HTTPException(status_code=400, detail="Cannot deactivate yourself")
    db = get_db()
    before = await db.users.find_one({"id": user_id}, {"_id": 0})
    if not before:
        raise HTTPException(status_code=404, detail="User not found")
    await db.users.update_one({"id": user_id}, {"$set": {"active": False, "updated_at": utcnow_iso()}})
    after = await db.users.find_one({"id": user_id}, {"_id": 0})
    await write_audit(
        user_id=current_user["id"],
        entity_type="user",
        entity_id=user_id,
        action="delete",
        before=_user_out(before),
        after=_user_out(after),
    )
    return {"ok": True}


# ---------------- Projects ----------------

@router.get("/projects")
async def list_projects(current_user: dict = Depends(get_current_user)):
    db = get_db()
    q: dict = {}
    if not is_all_projects_user(current_user):
        scope = get_project_scope(current_user) or []
        if not scope: return []
        q["id"] = {"$in": scope}
    return await db.projects.find(q, {"_id": 0}).sort("name", 1).to_list(500)


@router.get("/projects/{project_id}")
async def get_project(project_id: str, current_user: dict = Depends(get_current_user)):
    db = get_db()
    doc = await db.projects.find_one({"id": project_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Project not found")
    if not is_all_projects_user(current_user):
        scope = get_project_scope(current_user) or []
        if project_id not in scope:
            raise HTTPException(status_code=404, detail="Project not found")
    return doc


@router.post("/projects", response_model=Project)
async def create_project(
    payload: ProjectCreate,
    current_user: dict = Depends(require_super_admin()),
):
    db = get_db()
    if await db.projects.find_one({"code": payload.code}):
        raise HTTPException(status_code=409, detail="Project code already exists")
    proj = Project(**payload.model_dump())
    await db.projects.insert_one(proj.model_dump())
    await write_audit(
        user_id=current_user["id"],
        entity_type="project",
        entity_id=proj.id,
        action="create",
        after=proj.model_dump(),
    )
    return proj


@router.put("/projects/{project_id}", response_model=Project)
async def update_project(
    project_id: str,
    payload: ProjectUpdate,
    current_user: dict = Depends(require_super_admin()),
):
    db = get_db()
    before = await db.projects.find_one({"id": project_id}, {"_id": 0})
    if not before:
        raise HTTPException(status_code=404, detail="Project not found")
    changes = payload.model_dump(exclude_unset=True)
    if "code" in changes and changes["code"] != before["code"]:
        if await db.projects.find_one({"code": changes["code"]}):
            raise HTTPException(status_code=409, detail="Project code already exists")
    if changes:
        await db.projects.update_one({"id": project_id}, {"$set": changes})
    after = await db.projects.find_one({"id": project_id}, {"_id": 0})
    await write_audit(
        user_id=current_user["id"],
        entity_type="project",
        entity_id=project_id,
        action="update",
        before=before,
        after=after,
    )
    return Project(**after)


@router.delete("/projects/{project_id}")
async def delete_project(
    project_id: str,
    current_user: dict = Depends(require_super_admin()),
):
    db = get_db()
    before = await db.projects.find_one({"id": project_id}, {"_id": 0})
    if not before:
        raise HTTPException(status_code=404, detail="Project not found")
    if await db.bookings.count_documents({"project_id": project_id}) > 0:
        raise HTTPException(status_code=400, detail="Cannot delete a project with bookings")
    await db.projects.update_one({"id": project_id}, {"$set": {"status": "Closed"}})
    after = await db.projects.find_one({"id": project_id}, {"_id": 0})
    await write_audit(
        user_id=current_user["id"],
        entity_type="project",
        entity_id=project_id,
        action="delete",
        before=before,
        after=after,
    )
    return {"ok": True}


# ---------------- Units ----------------

@router.get("/units")
async def list_units(
    project_id: Optional[str] = None,
    status: Optional[str] = None,
    current_user: dict = Depends(get_current_user),
):
    db = get_db()
    q: dict = {}
    if project_id:
        q["project_id"] = project_id
    if status:
        q["status"] = status
    if not is_all_projects_user(current_user):
        scope = get_project_scope(current_user) or []
        if not scope: return []
        if "project_id" in q:
            if q["project_id"] not in scope: return []
        else:
            q["project_id"] = {"$in": scope}
    return await db.units.find(q, {"_id": 0}).sort("code", 1).to_list(1000)


@router.get("/units/{unit_id}")
async def get_unit(unit_id: str, current_user: dict = Depends(get_current_user)):
    db = get_db()
    doc = await db.units.find_one({"id": unit_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Unit not found")
    if not is_all_projects_user(current_user):
        scope = get_project_scope(current_user) or []
        if doc.get("project_id") not in scope:
            raise HTTPException(status_code=404, detail="Unit not found")
    return doc


UNIT_TYPES = {"Apartment", "Villa", "Commercial Office"}


def _validate_unit_payload(project_id, code, tower, floor, unit_type, *, on_create=True):
    if on_create:
        missing = []
        if not project_id: missing.append("project_id")
        if not code: missing.append("code")
        if not unit_type: missing.append("unit_type")
        if not (tower or floor): missing.append("tower_or_floor")
        if missing:
            raise HTTPException(status_code=400, detail=f"Missing required fields: {', '.join(missing)}")
    if unit_type is not None and unit_type not in UNIT_TYPES:
        raise HTTPException(status_code=400, detail=f"unit_type must be one of {sorted(UNIT_TYPES)}")


@router.post("/units", response_model=Unit)
async def create_unit(
    payload: UnitCreate,
    current_user: dict = Depends(require_super_admin()),
):
    db = get_db()
    _validate_unit_payload(payload.project_id, payload.code, payload.tower, payload.floor, payload.unit_type, on_create=True)
    if not await db.projects.find_one({"id": payload.project_id}):
        raise HTTPException(status_code=400, detail="Invalid project_id")
    if await db.units.find_one({"project_id": payload.project_id, "code": payload.code}):
        raise HTTPException(status_code=409, detail="Unit code already exists in this project")
    unit = Unit(**payload.model_dump())
    await db.units.insert_one(unit.model_dump())
    await write_audit(
        user_id=current_user["id"],
        entity_type="unit",
        entity_id=unit.id,
        action="create",
        after=unit.model_dump(),
    )
    return unit


@router.put("/units/{unit_id}", response_model=Unit)
async def update_unit(
    unit_id: str,
    payload: UnitUpdate,
    current_user: dict = Depends(require_super_admin()),
):
    db = get_db()
    before = await db.units.find_one({"id": unit_id}, {"_id": 0})
    if not before:
        raise HTTPException(status_code=404, detail="Unit not found")
    changes = payload.model_dump(exclude_unset=True)
    if "unit_type" in changes:
        _validate_unit_payload(None, None, None, None, changes["unit_type"], on_create=False)
    # Post-update: at least one of tower/floor must be present
    merged = {**before, **changes}
    if not (merged.get("tower") or merged.get("floor")):
        raise HTTPException(status_code=400, detail="Missing required fields: tower_or_floor")
    if "project_id" in changes and not await db.projects.find_one({"id": changes["project_id"]}):
        raise HTTPException(status_code=400, detail="Invalid project_id")
    if changes:
        await db.units.update_one({"id": unit_id}, {"$set": changes})
    after = await db.units.find_one({"id": unit_id}, {"_id": 0})
    await write_audit(
        user_id=current_user["id"],
        entity_type="unit",
        entity_id=unit_id,
        action="update",
        before=before,
        after=after,
    )
    return Unit(**after)


@router.delete("/units/{unit_id}")
async def delete_unit(
    unit_id: str,
    current_user: dict = Depends(require_super_admin()),
):
    db = get_db()
    before = await db.units.find_one({"id": unit_id}, {"_id": 0})
    if not before:
        raise HTTPException(status_code=404, detail="Unit not found")
    if await db.bookings.count_documents({"unit_id": unit_id, "status": {"$ne": "Cancelled"}}) > 0:
        raise HTTPException(status_code=400, detail="Cannot delete a unit with an active booking")
    await db.units.delete_one({"id": unit_id})
    await write_audit(
        user_id=current_user["id"],
        entity_type="unit",
        entity_id=unit_id,
        action="delete",
        before=before,
    )
    return {"ok": True}


# ==================== Phase 9: /me/projects + assign-projects ====================

from kernel.identity.auth_scope import is_all_projects_user, get_project_scope  # noqa: E402
from pydantic import BaseModel as _BaseModel  # noqa: E402


@router.get("/me/projects")
async def me_projects(current_user: dict = Depends(get_current_user)):
    """Returns projects the caller can access.
    All-projects users get every Active/Handover project. Scoped users get only their assigned ones."""
    db = get_db()
    if is_all_projects_user(current_user):
        docs = await db.projects.find({}, {"_id": 0, "id": 1, "code": 1, "name": 1, "type": 1, "status": 1}).to_list(500)
        return docs
    ids = get_project_scope(current_user) or []
    if not ids: return []
    docs = await db.projects.find({"id": {"$in": ids}}, {"_id": 0, "id": 1, "code": 1, "name": 1, "type": 1, "status": 1}).to_list(500)
    return docs


@router.get("/me/permissions")
async def me_permissions(current_user: dict = Depends(get_current_user)):
    """Return the caller's canonical role, project scope and full module map.
    Consumed by the frontend to gate UI (Phase B)."""
    from kernel.identity.rbac_matrix import (
        canonical_role, matrix_for_role, visible_journey_stages,
        READ_STATUS_ONLY, READ_LIMITED,
    )

    raw = (current_user.get("role") or {}).get("code") or ""
    canon = canonical_role(raw)
    modules = matrix_for_role(raw)
    # Super Admin detection: either an explicit ``is_super_admin`` flag on the
    # user doc (production accounts) OR a role code of ``SUPER_ADMIN`` (seeded
    # admins whose only super-admin marker is the role). Matches
    # ``auth_scope.is_all_projects_user`` behaviour on this attribute.
    is_super = bool(current_user.get("is_super_admin")) or raw.upper() == "SUPER_ADMIN"
    redactions = {
        "financial_amounts": modules.get("customer_financials") == READ_STATUS_ONLY or modules.get("collections") == READ_STATUS_ONLY,
        "customer_pii": modules.get("customer_overview") == READ_LIMITED,
    }
    # Super admin always sees every stage — pass null to signal "no filter".
    journey_stages = None if is_super else visible_journey_stages(raw)
    return {
        "user_id": current_user.get("id"),
        "role": canon,
        "role_code": raw,
        "is_super_admin": is_super,
        "assigned_project_ids": current_user.get("assigned_project_ids") or [],
        "modules": modules,
        "redactions": redactions,
        "journey_stage_visibility": journey_stages,
    }


class AssignProjectsPayload(_BaseModel):
    project_ids: list[str]


@router.post("/admin/users/{user_id}/assign-projects")
async def assign_projects(
    user_id: str,
    payload: AssignProjectsPayload,
    current_user: dict = Depends(require_super_admin()),
):
    db = get_db()
    user = await db.users.find_one({"id": user_id}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if payload.project_ids:
        existing = await db.projects.find({"id": {"$in": payload.project_ids}}, {"_id": 0, "id": 1}).to_list(500)
        found = {p["id"] for p in existing}
        missing = [p for p in payload.project_ids if p not in found]
        if missing:
            raise HTTPException(status_code=400, detail=f"Unknown project id(s): {missing}")
    before = _user_out(user)
    await db.users.update_one({"id": user_id}, {"$set": {"assigned_project_ids": list(payload.project_ids), "updated_at": utcnow_iso()}})
    after_full = await db.users.find_one({"id": user_id}, {"_id": 0})
    await write_audit(
        user_id=current_user["id"], entity_type="user", entity_id=user_id,
        action="update", before=before, after=_user_out(after_full),
    )
    return _user_out(after_full)

