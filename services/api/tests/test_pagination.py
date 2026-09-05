"""Cursor round-trip and the limit clamp (technical/07 §1)."""
from __future__ import annotations

import pytest

from kernel.errors import AppError
from kernel.pagination import DEFAULT_LIMIT, clamp_limit, decode_cursor, encode_cursor, paginate


def test_cursor_round_trips() -> None:
    assert decode_cursor(encode_cursor("2026-09-05T10:00:00Z", "abc-1")) == ("2026-09-05T10:00:00Z", "abc-1")


def test_malformed_cursor_is_a_validation_error() -> None:
    with pytest.raises(AppError) as e:
        decode_cursor("!!!not-base64!!!")
    assert e.value.status_code == 400


@pytest.mark.parametrize("limit", [0, -1, 201])
def test_limit_is_clamped(limit: int) -> None:
    with pytest.raises(AppError):
        clamp_limit(limit)


def test_default_limit() -> None:
    assert clamp_limit(None) == DEFAULT_LIMIT


def test_extra_row_only_signals_a_next_page() -> None:
    rows = [{"k": i, "id": f"id{i}"} for i in range(6)]
    page = paginate(rows, 5, lambda r: r["k"], lambda r: r["id"])
    assert len(page.items) == 5
    assert decode_cursor(page.next_cursor or "") == ("4", "id4")
    assert paginate(rows[:3], 5, lambda r: r["k"], lambda r: r["id"]).next_cursor is None
