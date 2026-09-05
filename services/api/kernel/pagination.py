"""Opaque cursor pagination (technical/07 §1).

The cursor is base64url of `<sort_key>|<id>` — opaque on the wire, cheap to build,
and stable because the sort key is always paired with the row id.
"""
from __future__ import annotations

import base64
import binascii
from dataclasses import dataclass
from typing import Any

from kernel.errors import AppError

DEFAULT_LIMIT = 50
MAX_LIMIT = 200


def encode_cursor(sort_key: Any, row_id: Any) -> str:
    raw = f"{sort_key}|{row_id}".encode()
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def decode_cursor(cursor: str) -> tuple[str, str]:
    try:
        raw = base64.urlsafe_b64decode(cursor + "=" * (-len(cursor) % 4)).decode()
        sort_key, _, row_id = raw.partition("|")
    except (binascii.Error, UnicodeDecodeError) as exc:
        raise AppError("VALIDATION", "Malformed cursor.", field="cursor") from exc
    if not row_id:
        raise AppError("VALIDATION", "Malformed cursor.", field="cursor")
    return sort_key, row_id


@dataclass(frozen=True)
class Page:
    """A slice of a list plus the cursor that fetches the next one."""

    items: list[Any]
    next_cursor: str | None

    def meta(self, request_id: str) -> dict[str, Any]:
        meta: dict[str, Any] = {"request_id": request_id}
        if self.next_cursor:
            meta["next_cursor"] = self.next_cursor
        return meta


def clamp_limit(limit: int | None) -> int:
    if limit is None:
        return DEFAULT_LIMIT
    if limit < 1 or limit > MAX_LIMIT:
        raise AppError("VALIDATION", f"limit must be between 1 and {MAX_LIMIT}.", field="limit")
    return limit


def paginate(rows: list[Any], limit: int, sort_key_of: Any, id_of: Any) -> Page:
    """`rows` is fetched with `limit + 1`; the extra row only tells us a next page exists."""
    if len(rows) > limit:
        last = rows[limit - 1]
        return Page(items=rows[:limit], next_cursor=encode_cursor(sort_key_of(last), id_of(last)))
    return Page(items=rows, next_cursor=None)
