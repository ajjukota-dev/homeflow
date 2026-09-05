"""`Idempotency-Key` on every creating/transitioning POST (technical/07 §1).

The key is scoped to the principal so two users cannot collide, and to the request body
hash so a replay with a *different* body is a conflict rather than a silent wrong answer.
Rows live in `idempotency_key` (migration 0001) and are pruned after 24 h.
"""
from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from typing import Any

from fastapi import Header, Request
from sqlalchemy import text

from kernel.db import Tx
from kernel.errors import AppError

_SELECT = text(
    "SELECT response_hash, response FROM idempotency_key"
    " WHERE key = :key AND principal = :principal AND expires_at > now()"
)
_INSERT = text(
    "INSERT INTO idempotency_key (key, principal, request_hash, response_hash, response, expires_at)"
    " VALUES (:key, :principal, :request_hash, :response_hash, cast(:response as jsonb),"
    "         now() + interval '24 hours')"
    " ON CONFLICT (key, principal) DO NOTHING"
)


def _hash(payload: Any) -> str:
    return hashlib.sha256(json.dumps(payload, sort_keys=True, default=str).encode()).hexdigest()


@dataclass(frozen=True)
class IdempotencyKey:
    """Present on the request or not; `None` means the caller opted out."""

    key: str | None

    async def replay(self, tx: Tx, principal: str) -> dict[str, Any] | None:
        if not self.key:
            return None
        row = (await tx.conn.execute(_SELECT, {"key": self.key, "principal": principal})).first()
        return dict(row.response) if row else None

    async def store(self, tx: Tx, principal: str, request_body: Any, response: Any) -> None:
        if not self.key:
            return
        await tx.conn.execute(
            _INSERT,
            {
                "key": self.key,
                "principal": principal,
                "request_hash": _hash(request_body),
                "response_hash": _hash(response),
                "response": json.dumps(response, default=str),
            },
        )


async def idempotency_key(
    request: Request,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
) -> IdempotencyKey:
    """FastAPI dependency. Rejects an unusable key rather than silently ignoring it."""
    if idempotency_key is not None and not 8 <= len(idempotency_key) <= 200:
        raise AppError("VALIDATION", "Idempotency-Key must be 8-200 characters.", field="Idempotency-Key")
    request.state.idempotency_key = idempotency_key
    return IdempotencyKey(key=idempotency_key)
