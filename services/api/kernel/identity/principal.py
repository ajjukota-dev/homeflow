"""Principal + the two built-in principals (technical/03 §4)."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal
from uuid import UUID

Realm = Literal["staff", "customer", "none"]


@dataclass(frozen=True)
class Principal:
    realm: Realm
    user_id: UUID | None = None
    customer_id: UUID | None = None
    role_ids: frozenset[str] = field(default_factory=frozenset)
    project_ids: frozenset[UUID] = field(default_factory=frozenset)
    all_projects: bool = False
    display_name: str = ""
    session_id: UUID | None = None

    @property
    def is_authenticated(self) -> bool:
        return self.realm != "none"

    def as_actor(self) -> dict[str, Any]:
        """The `event.actor` envelope (foundation/event-log.md §1)."""
        if self.realm == "staff" and self.user_id is None:
            return {"type": "system", "id": None, "name": self.display_name or "system"}
        if self.realm == "customer":
            return {"type": "customer", "id": str(self.customer_id), "name": self.display_name}
        if self.realm == "staff":
            return {"type": "user", "id": str(self.user_id), "name": self.display_name}
        return {"type": "system", "id": None, "name": "anonymous"}


# The ticker and migrations run as SYSTEM; it is the only all-projects staff principal
# constructed in code rather than loaded from a session row (technical/03 §6).
SYSTEM = Principal(realm="staff", all_projects=True, display_name="system")

# No session: app.realm = 'none' makes every RLS policy evaluate false, so a route that
# forgets require() still sees zero rows.
ANONYMOUS = Principal(realm="none", display_name="anonymous")
