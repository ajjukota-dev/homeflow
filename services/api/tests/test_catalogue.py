"""The catalogue is the foundation's list, and nothing appends outside it (technical/04 §1)."""
from __future__ import annotations

import re
from pathlib import Path

import pytest

from kernel.events.catalogue import CATALOGUE, REASON_REQUIRED

REPO = Path(__file__).resolve().parents[3]
EVENT_LOG = REPO / "docs" / "spec" / "foundation" / "event-log.md"
API = Path(__file__).resolve().parents[1]

#: `a.b` / `a.b.c` in backticks — the only way the catalog section writes an event name.
_BACKTICKED = re.compile(r"`([a-z][a-z_]*(?:\.[a-z][a-z_]*)+)`")


def _catalogued_in_the_spec() -> set[str]:
    text = EVENT_LOG.read_text(encoding="utf-8")
    section = text.split("## 3. Event catalog", 1)[1].split("\n## 4.", 1)[0]
    return set(_BACKTICKED.findall(section))


def test_the_spec_section_actually_parses() -> None:
    names = _catalogued_in_the_spec()
    assert len(names) >= 150, f"only found {len(names)} names - the parser has drifted"
    assert "booking.handover.accepted" in names


def test_every_event_in_the_foundation_is_catalogued() -> None:
    missing = sorted(_catalogued_in_the_spec() - set(CATALOGUE))
    assert not missing, f"not in kernel/events/catalogue.py: {missing}"


def test_every_catalogued_type_is_in_the_foundation_or_is_a_kernel_event() -> None:
    kernel_only = {
        "user.provisioned", "user.deactivated", "user.signed_in", "user.signed_out",
        "customer.signed_in", "session.revoked", "permission.changed", "config.changed",
        "job.dead", "migration.imported", "legacy.audit", "file.attached",
    }
    extra = sorted(set(CATALOGUE) - _catalogued_in_the_spec() - kernel_only)
    assert not extra, f"invented event types: {extra}"


def test_reason_required_flags_match_the_reason_required_set() -> None:
    assert REASON_REQUIRED <= set(CATALOGUE)
    for name, entry in CATALOGUE.items():
        assert entry.reason_required is (name in REASON_REQUIRED), name


#: `append(tx, "type", ...)` — the tx-shaped first argument and the dotted name together
#: keep plain `list.append("something")` calls out of the grep (technical/04 §1).
_APPEND_CALL = re.compile(r"""append\(\s*(?:tx|t|conn)\s*,\s*["']([a-z][a-z_]*(?:\.[a-z][a-z_]*)+)["']""")
_SKIP = {".venv", "__pycache__", "tests", "migration"}


@pytest.mark.parametrize("root", ["kernel", "modules", "domain", "seeds"])
def test_every_append_call_site_uses_a_catalogued_type(root: str) -> None:
    offenders: list[str] = []
    for path in (API / root).rglob("*.py"):
        if any(part in _SKIP for part in path.parts):
            continue
        for match in _APPEND_CALL.finditer(path.read_text(encoding="utf-8")):
            if match.group(1) not in CATALOGUE:
                offenders.append(f"{path.relative_to(API)}: {match.group(1)}")
    assert not offenders, offenders
