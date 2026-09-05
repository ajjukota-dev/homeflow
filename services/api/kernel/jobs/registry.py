"""The `@job(kind)` handler registry and the retry arithmetic (technical/04 §3).

Both are pure so the ticker's policy can be tested without a database or a clock.
"""
from __future__ import annotations

from collections.abc import Awaitable, Callable
from datetime import datetime, time, timedelta
from typing import Any, Protocol, cast

from kernel.db import Tx

Handler = Callable[[Tx, dict[str, Any]], Awaitable[None]]

HANDLERS: dict[str, Handler] = {}

#: technical/04 §3 — `run_at = now() + 30s x 2^attempts`.
BACKOFF_BASE = timedelta(seconds=30)
MAX_BACKOFF = timedelta(hours=1)


class Clock(Protocol):
    def now(self) -> datetime: ...


def job(kind: str) -> Callable[[Handler], Handler]:
    """Register a handler. Re-registering the same kind is a bug, so it raises."""

    def register(fn: Handler) -> Handler:
        if kind in HANDLERS and HANDLERS[kind] is not fn:
            raise RuntimeError(f"two handlers registered for job kind {kind!r}")
        HANDLERS[kind] = fn
        return fn

    return register


def backoff(attempts: int) -> timedelta:
    """`attempts` is the count *after* this failure, so attempt 1 waits 60 s."""
    if attempts <= 0:
        return BACKOFF_BASE
    # Clamp the exponent before multiplying: timedelta overflows long before the cap bites.
    return cast(timedelta, min(BACKOFF_BASE * (2 ** min(attempts, 20)), MAX_BACKOFF))


def next_run(
    now: datetime, *, every_seconds: int | None = None, daily_at: time | None = None
) -> datetime:
    """When a schedule is due again. Exactly one cadence is set (technical/02 §4.3)."""
    if every_seconds is not None:
        return now + timedelta(seconds=every_seconds)
    if daily_at is None:
        raise ValueError("a schedule needs either every_seconds or daily_at")
    today = now.replace(
        hour=daily_at.hour, minute=daily_at.minute, second=daily_at.second, microsecond=0
    )
    return today if today > now else today + timedelta(days=1)
