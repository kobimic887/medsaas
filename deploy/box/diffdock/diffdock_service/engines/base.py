from __future__ import annotations

from typing import Protocol

from ..models import EngineRequest, Pose


class DiffDockEngine(Protocol):
    """The whole GPU boundary. Everything else in this service is testable without one."""

    name: str

    def preflight(self) -> None:
        """Raise EngineUnavailable if this engine could not serve a request right now."""
        ...

    def dock(self, request: EngineRequest) -> list[Pose]:
        """Return poses ranked best-first. Raise DockFailure if none could be produced."""
        ...
