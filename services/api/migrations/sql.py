"""Run a multi-statement SQL script through asyncpg.

asyncpg prepares every statement, and a prepared statement may hold exactly one command,
so `op.execute("CREATE TABLE a (…); CREATE TABLE b (…);")` fails. Splitting here keeps the
migrations readable as SQL scripts instead of a hundred one-line `op.execute` calls.
"""
from __future__ import annotations

import re

from alembic import op

_DOLLAR_TAG = re.compile(r"\$[A-Za-z_][A-Za-z_0-9]*\$|\$\$")


def split_statements(script: str) -> list[str]:
    """Split on top-level `;`, respecting '…' literals, $tag$…$tag$ bodies and -- comments."""
    out: list[str] = []
    buf: list[str] = []
    tag: str | None = None
    in_quote = False
    i, n = 0, len(script)

    while i < n:
        ch = script[i]
        if tag is not None:
            if script.startswith(tag, i):
                buf.append(tag)
                i += len(tag)
                tag = None
                continue
        elif in_quote:
            if ch == "'":
                if i + 1 < n and script[i + 1] == "'":
                    buf.append("''")
                    i += 2
                    continue
                in_quote = False
        elif ch == "'":
            in_quote = True
        elif ch == "$":
            m = _DOLLAR_TAG.match(script, i)
            if m:
                tag = m.group(0)
                buf.append(tag)
                i += len(tag)
                continue
        elif script.startswith("--", i):
            nl = script.find("\n", i)
            i = n if nl == -1 else nl
            continue
        elif ch == ";":
            out.append("".join(buf))
            buf = []
            i += 1
            continue
        buf.append(ch)
        i += 1

    out.append("".join(buf))
    return [s.strip() for s in out if s.strip()]


def sql(script: str) -> None:
    """Execute every statement in `script`, in order."""
    for statement in split_statements(script):
        op.execute(statement)
