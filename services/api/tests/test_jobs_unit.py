"""Retry backoff, schedule expansion and the consumers map — no database (technical/04)."""
from __future__ import annotations

from datetime import UTC, datetime, time, timedelta

import pytest

from kernel.events.consumers import CONSUMERS
from kernel.jobs.registry import BACKOFF_BASE, HANDLERS, MAX_BACKOFF, backoff, job, next_run


class FrozenClock:
    """The injectable `Clock` of technical/01 §4, so schedule maths needs no real time."""

    def __init__(self, at: datetime) -> None:
        self._at = at

    def now(self) -> datetime:
        return self._at


def test_backoff_doubles_and_is_capped() -> None:
    assert backoff(0) == BACKOFF_BASE
    assert backoff(1) == timedelta(seconds=60)
    assert backoff(2) == timedelta(seconds=120)
    assert backoff(3) == timedelta(seconds=240)
    assert backoff(4) == timedelta(seconds=480)
    assert backoff(50) == MAX_BACKOFF


def test_every_seconds_schedules_from_now() -> None:
    clock = FrozenClock(datetime(2026, 9, 5, 11, 30, tzinfo=UTC))
    assert next_run(clock.now(), every_seconds=300) == datetime(2026, 9, 5, 11, 35, tzinfo=UTC)


def test_daily_at_picks_today_when_it_is_still_ahead() -> None:
    clock = FrozenClock(datetime(2026, 9, 5, 1, 0, tzinfo=UTC))
    assert next_run(clock.now(), daily_at=time(4, 0)) == datetime(2026, 9, 5, 4, 0, tzinfo=UTC)


def test_daily_at_rolls_to_tomorrow_once_it_has_passed() -> None:
    clock = FrozenClock(datetime(2026, 9, 5, 4, 0, 1, tzinfo=UTC))
    assert next_run(clock.now(), daily_at=time(4, 0)) == datetime(2026, 9, 6, 4, 0, tzinfo=UTC)


def test_a_schedule_needs_a_cadence() -> None:
    with pytest.raises(ValueError):
        next_run(datetime.now(UTC))


def test_registering_two_handlers_for_one_kind_is_refused() -> None:
    @job("test.only-one")
    async def _first(tx, args) -> None:  # noqa: ANN001
        return None

    with pytest.raises(RuntimeError):

        @job("test.only-one")
        async def _second(tx, args) -> None:  # noqa: ANN001
            return None

    HANDLERS.pop("test.only-one", None)


def test_the_housekeeping_handlers_are_registered() -> None:
    import kernel.jobs.handlers  # noqa: F401

    assert {"job.reap", "job.prune"} <= set(HANDLERS)


def test_every_consumer_names_a_registered_handler() -> None:
    """A consumer that points at nothing would silently drop work (technical/04 §2)."""
    import kernel.jobs.handlers  # noqa: F401

    missing = sorted(
        {c.kind for consumers in CONSUMERS.values() for c in consumers} - set(HANDLERS)
    )
    assert not missing, f"consumers with no handler: {missing}"
