"""Field-level redaction, matrix-driven (technical/03 §8).

v1's `rbac_redact.py` hard-coded two field sets against two role levels. The rules are
now data: `permission.modifiers` holds `hidden_fields` (removed) and `masked_fields`
(shown as `XXXXX1234F`). This module only applies them.
"""
from __future__ import annotations

from typing import Any

from kernel.identity.principal import Principal
from kernel.identity.rbac import modifiers_of

MASK_CHAR = "X"
KEEP_TAIL = 4


def mask(value: Any) -> Any:
    """PAN -> `XXXXX1234F`: keep the last four visible, hide the rest."""
    if value is None:
        return None
    s = str(value)
    if len(s) <= KEEP_TAIL:
        return MASK_CHAR * len(s)
    return MASK_CHAR * (len(s) - KEEP_TAIL) + s[-KEEP_TAIL:]


def _rules(p: Principal, module: str) -> tuple[frozenset[str], frozenset[str]]:
    """Union across the caller's roles is wrong for privileges but right for secrecy:
    a field is hidden only if *every* role of the caller hides it."""
    if p.realm != "staff" or p.user_id is None:
        return frozenset(), frozenset()
    hidden: set[str] | None = None
    masked: set[str] | None = None
    for role in p.role_ids:
        mods = modifiers_of(role, module)
        h = set(mods.get("hidden_fields", ()))
        m = set(mods.get("masked_fields", ()))
        hidden = h if hidden is None else (hidden & h)
        masked = m if masked is None else (masked & m)
    return frozenset(hidden or ()), frozenset(masked or ())


def redact(model: Any, principal: Principal, module: str) -> Any:
    """Apply the caller's modifiers to a Pydantic model, dict, or list of either."""
    hidden, masked = _rules(principal, module)
    if not hidden and not masked:
        return _plain(model)
    return _walk(_plain(model), hidden, masked)


def _plain(model: Any) -> Any:
    dump = getattr(model, "model_dump", None)
    if callable(dump):
        return dump(mode="json")
    if isinstance(model, list):
        return [_plain(x) for x in model]
    return model


def _walk(value: Any, hidden: frozenset[str], masked: frozenset[str]) -> Any:
    if isinstance(value, list):
        return [_walk(v, hidden, masked) for v in value]
    if isinstance(value, dict):
        out: dict[str, Any] = {}
        for k, v in value.items():
            if k in hidden:
                continue
            out[k] = mask(v) if k in masked else _walk(v, hidden, masked)
        return out
    return value
