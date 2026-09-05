"""Schedule rows (technical/04 §4). Only the kinds that have a registered handler today;
the rest arrive with the slice that owns them, one row each."""
from __future__ import annotations

from datetime import time

SCHEDULES: tuple[dict[str, object], ...] = (
    {"kind": "job.reap", "every": 300, "daily": None},
    {"kind": "job.prune", "every": None, "daily": time(4, 0)},
    {"kind": "file.prune", "every": None, "daily": time(4, 30)},
)
