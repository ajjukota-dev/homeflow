"""Compatibility shim for the v1 Mongo routers (foundation/v1-reuse.md §4.6).

v1 authenticated with bcrypt + a JWT it minted itself. That is gone: the identity of
record is now the `session` row and the `Principal` built by `SessionMiddleware`
(technical/03). The thirty v1 routers still `Depends(get_current_user)`, so this module
keeps that name and returns the same *shape* of dict — built from the Principal, never
from a token. It disappears with each router as it is ported.
"""
from __future__ import annotations

from fastapi import Request

from kernel.errors import AppError
from kernel.identity.principal import Principal

SUPER_ADMIN = "super_admin"


def _as_v1_user(p: Principal) -> dict:
    """v1 routers read `["id"]`, `["role"]["code"]` and `["role"]["is_super_admin"]`."""
    roles = sorted(p.role_ids)
    return {
        "id": str(p.user_id or p.customer_id),
        "email": "",
        "name": p.display_name,
        "active": True,
        "role": {
            "code": SUPER_ADMIN if SUPER_ADMIN in p.role_ids else (roles[0] if roles else "unknown"),
            "is_super_admin": SUPER_ADMIN in p.role_ids,
        },
        "department": None,
        # `auth_scope.is_all_projects_user` reads this top-level flag; an all-projects
        # principal must not fall through to an empty `assigned_project_ids` scope.
        "is_super_admin": p.all_projects or SUPER_ADMIN in p.role_ids,
        "assigned_project_ids": sorted(str(i) for i in p.project_ids),
    }


async def get_current_user(request: Request) -> dict:
    p: Principal = getattr(request.state, "principal", None) or Principal(realm="none")
    if not p.is_authenticated or p.realm != "staff":
        raise AppError("UNAUTHENTICATED", "Sign in to continue.")
    return _as_v1_user(p)


def require_roles(*allowed_codes: str):
    async def _guard(request: Request) -> dict:
        current_user = await get_current_user(request)
        role = current_user["role"]
        if role["code"] not in allowed_codes and not role["is_super_admin"]:
            raise AppError("FORBIDDEN", "Not permitted.")
        return current_user

    return _guard


def require_super_admin():
    async def _guard(request: Request) -> dict:
        current_user = await get_current_user(request)
        if not current_user["role"]["is_super_admin"]:
            raise AppError("FORBIDDEN", "Super Admin only.")
        return current_user

    return _guard
