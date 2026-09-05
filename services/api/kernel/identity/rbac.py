"""The RBAC matrix, `require()` and `require_role_in()` (technical/03 §7).

The matrix is `permission` rows, loaded into memory once at startup and reloaded when
Policy Studio changes them (`config.changed` -> job `config.reload`). v1's hard-coded
`rbac_matrix.PERMISSION_MATRIX` is now only the *seed* for those rows.
"""
from __future__ import annotations

from collections.abc import Awaitable, Callable, Iterable
from typing import Any, Literal, cast

from sqlalchemy import text
from starlette.requests import Request

from kernel.db import tx
from kernel.errors import AppError
from kernel.identity.principal import SYSTEM, Principal

Action = Literal["read", "write", "admin"]

#: technical/02 §4.1 — the six levels, in order.
LEVELS: dict[str, int] = {
    "none": 0,
    "read_status_only": 1,
    "read_limited": 1,
    "read": 1,
    "write": 2,
    "admin": 3,
}
NEEDED: dict[str, int] = {"read": 1, "write": 2, "admin": 3}

#: The only module a customer-realm principal may reach (technical/03 §7).
CUSTOMER_MODULE = "customer_portal"

# role_id -> module -> level, and role_id -> module -> modifiers.
_LEVELS: dict[str, dict[str, str]] = {}
_MODIFIERS: dict[str, dict[str, dict[str, Any]]] = {}


async def reload() -> None:
    """Read `permission` into memory. Called at startup and by `config.reload`."""
    async with tx(SYSTEM) as t:
        rows = (
            await t.conn.execute(text("SELECT role_id, module, level, modifiers FROM permission"))
        ).all()
    levels: dict[str, dict[str, str]] = {}
    modifiers: dict[str, dict[str, dict[str, Any]]] = {}
    for role_id, module, level, mods in rows:
        levels.setdefault(role_id, {})[module] = level
        modifiers.setdefault(role_id, {})[module] = mods or {}
    _LEVELS.clear()
    _LEVELS.update(levels)
    _MODIFIERS.clear()
    _MODIFIERS.update(modifiers)


def load_from(
    levels: dict[str, dict[str, str]],
    modifiers: dict[str, dict[str, dict[str, Any]]] | None = None,
) -> None:
    """Test seam: install a matrix without a database."""
    _LEVELS.clear()
    _LEVELS.update(levels)
    _MODIFIERS.clear()
    _MODIFIERS.update(modifiers or {})


def level_of(role_id: str, module: str) -> str:
    return _LEVELS.get(role_id, {}).get(module, "none")


def modifiers_of(role_id: str, module: str) -> dict[str, Any]:
    return _MODIFIERS.get(role_id, {}).get(module, {})


def allows(p: Principal, module: str, action: Action) -> bool:
    if p.realm == "customer":
        return module == CUSTOMER_MODULE
    if p.realm != "staff":
        return False
    if p.user_id is None:  # SYSTEM — the ticker runs every handler
        return True
    want = NEEDED[action]
    return any(LEVELS.get(level_of(r, module), 0) >= want for r in p.role_ids)


def principal_of(request: Request) -> Principal:
    p = getattr(request.state, "principal", None)
    if p is None or not p.is_authenticated:
        raise AppError("UNAUTHENTICATED", "Sign in to continue.")
    return cast(Principal, p)


def require(module: str, action: Action = "read") -> Callable[[Request], Awaitable[Principal]]:
    """FastAPI dependency: the RBAC gate for one module (technical/03 §7)."""

    async def dep(request: Request) -> Principal:
        p = principal_of(request)
        if not allows(p, module, action):
            raise AppError("FORBIDDEN", f"Not permitted on {module}.", extra={"module": module})
        return p

    return dep


def require_role_in(roles: Iterable[str]) -> Callable[[Request], Awaitable[Principal]]:
    """Hard write fence beyond the matrix (technical/03 §7, foundation/gates.md A.7)."""
    allowed = frozenset(roles)

    async def dep(request: Request) -> Principal:
        p = principal_of(request)
        if p.realm == "staff" and p.user_id is None:
            return p
        if not (p.role_ids & allowed):
            raise AppError(
                "WRITE_FENCE",
                "This action is restricted to " + ", ".join(sorted(allowed)) + ".",
                extra={"allowed_roles": sorted(allowed)},
            )
        return p

    return dep
