"""Session rows, the `hf_session` cookie, and Principal loading (technical/03 §3-§4).

The token itself only ever lives in the cookie; the database stores `sha256(token)`.
"""
from __future__ import annotations

import hashlib
import secrets
from datetime import timedelta
from typing import Literal
from uuid import UUID

from sqlalchemy import text
from starlette.responses import Response

from kernel.db import Tx
from kernel.identity.principal import ANONYMOUS, Principal
from settings import settings

COOKIE_NAME = "hf_session"
OAUTH_COOKIE = "hf_oauth"

#: realm -> (idle timeout, absolute lifetime) — technical/03 §3.
TIMEOUTS: dict[str, tuple[timedelta, timedelta]] = {
    "staff": (timedelta(hours=12), timedelta(days=7)),
    "customer": (timedelta(days=30), timedelta(days=90)),
}
TOUCH_AFTER = timedelta(minutes=5)


def hash_token(token: str) -> bytes:
    return hashlib.sha256(token.encode()).digest()


def new_token() -> tuple[str, bytes]:
    token = secrets.token_urlsafe(32)
    return token, hash_token(token)


async def create(
    tx: Tx,
    realm: Literal["staff", "customer"],
    *,
    user_id: UUID | None = None,
    customer_id: UUID | None = None,
    ip: str | None = None,
    user_agent: str | None = None,
) -> tuple[UUID, str]:
    token, token_hash = new_token()
    _, absolute = TIMEOUTS[realm]
    row = await tx.conn.execute(
        text(
            "INSERT INTO session (token_hash, realm, user_id, customer_id, expires_at, ip, user_agent)"
            " VALUES (:h, :realm, :uid, :cid, now() + :ttl, cast(:ip as inet), :ua) RETURNING id"
        ),
        {
            "h": token_hash, "realm": realm, "uid": user_id, "cid": customer_id,
            "ttl": absolute, "ip": ip, "ua": user_agent,
        },
    )
    return row.scalar_one(), token


async def revoke(tx: Tx, session_id: UUID) -> None:
    await tx.conn.execute(
        text("UPDATE session SET revoked_at = now() WHERE id = :id AND revoked_at IS NULL"),
        {"id": session_id},
    )


async def revoke_all_for_user(tx: Tx, user_id: UUID) -> None:
    """Deactivation revokes every session in the same transaction (technical/03 §1)."""
    await tx.conn.execute(
        text("UPDATE session SET revoked_at = now() WHERE user_id = :uid AND revoked_at IS NULL"),
        {"uid": user_id},
    )


_LOOKUP = text(
    "SELECT s.id, s.realm, s.user_id, s.customer_id, s.last_seen_at,"
    "       u.full_name AS user_name, u.is_active, c.display_name AS customer_name"
    " FROM session s"
    ' LEFT JOIN "user" u ON u.id = s.user_id'
    "  LEFT JOIN customer c ON c.id = s.customer_id"
    " WHERE s.token_hash = :h AND s.revoked_at IS NULL AND s.expires_at > now()"
    "   AND s.last_seen_at > now() - (CASE s.realm WHEN 'staff'"
    "         THEN cast(:idle_staff as interval) ELSE cast(:idle_customer as interval) END)"
)

# asyncpg binds before the cast, so intervals go over the wire as timedelta, never as text.
_IDLE = {"idle_staff": TIMEOUTS["staff"][0], "idle_customer": TIMEOUTS["customer"][0]}


async def load_principal(tx: Tx, token: str) -> Principal:
    """Cookie token -> Principal, or ANONYMOUS. Runs on a SYSTEM transaction.

    The identity tables carry no RLS (technical/02 §2 exempts them), but
    `project_team_assignment` does — and it is the very table that decides
    `app.project_ids`, so this one lookup has to run all-projects.
    """
    row = (
        await tx.conn.execute(_LOOKUP, {"h": hash_token(token), **_IDLE})
    ).mappings().first()
    if row is None or (row["realm"] == "staff" and not row["is_active"]):
        return ANONYMOUS
    await _touch(tx, row["id"])
    if row["realm"] == "customer":
        return Principal(
            realm="customer",
            customer_id=row["customer_id"],
            display_name=row["customer_name"] or "",
            session_id=row["id"],
            project_ids=await _customer_projects(tx, row["customer_id"]),
        )
    roles, all_projects = await _roles(tx, row["user_id"])
    return Principal(
        realm="staff",
        user_id=row["user_id"],
        role_ids=roles,
        project_ids=frozenset() if all_projects else await _staff_projects(tx, row["user_id"]),
        all_projects=all_projects,
        display_name=row["user_name"] or "",
        session_id=row["id"],
    )


async def _touch(tx: Tx, session_id: UUID) -> None:
    await tx.conn.execute(
        text(
            "UPDATE session SET last_seen_at = now() WHERE id = :id"
            "  AND last_seen_at < now() - cast(:after as interval)"
        ),
        {"id": session_id, "after": TOUCH_AFTER},
    )


async def _roles(tx: Tx, user_id: UUID) -> tuple[frozenset[str], bool]:
    rows = (
        await tx.conn.execute(
            text(
                "SELECT r.id, r.all_projects FROM user_role_assignment ura"
                " JOIN role r ON r.id = ura.role_id WHERE ura.user_id = :uid"
            ),
            {"uid": user_id},
        )
    ).all()
    return frozenset(r[0] for r in rows), any(r[1] for r in rows)


async def _staff_projects(tx: Tx, user_id: UUID) -> frozenset[UUID]:
    rows = (
        await tx.conn.execute(
            text(
                "SELECT DISTINCT project_id FROM project_team_assignment"
                " WHERE (primary_owner_id = :uid OR backup_owner_id = :uid"
                "        OR escalation_manager_id = :uid)"
                "   AND effective_from <= current_date"
                "   AND coalesce(effective_to, 'infinity'::date) > current_date"
            ),
            {"uid": user_id},
        )
    ).all()
    return frozenset(r[0] for r in rows)


async def _customer_projects(tx: Tx, customer_id: UUID) -> frozenset[UUID]:
    rows = (
        await tx.conn.execute(
            text(
                "SELECT DISTINCT b.project_id FROM booking b"
                " JOIN booking_applicant ba ON ba.booking_id = b.id"
                " WHERE ba.customer_id = :cid"
            ),
            {"cid": customer_id},
        )
    ).all()
    return frozenset(r[0] for r in rows)


def set_cookie(response: Response, token: str, realm: str) -> None:
    _, absolute = TIMEOUTS[realm]
    response.set_cookie(
        COOKIE_NAME,
        token,
        max_age=int(absolute.total_seconds()),
        httponly=True,
        secure=settings.ENV != "local",
        samesite="lax",
        path="/",
    )


def clear_cookie(response: Response) -> None:
    response.delete_cookie(COOKIE_NAME, path="/")


__all__ = [
    "COOKIE_NAME", "OAUTH_COOKIE", "TIMEOUTS", "clear_cookie",
    "create", "hash_token", "load_principal", "new_token", "revoke", "revoke_all_for_user",
    "set_cookie",
]
