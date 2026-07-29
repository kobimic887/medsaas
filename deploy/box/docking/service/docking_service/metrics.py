from __future__ import annotations

from collections import Counter
from threading import Lock


class DockingMetrics:
    """In-process counters. Export wiring is deliberately deferred from foundation work."""

    def __init__(self) -> None:
        self._counts: Counter[str] = Counter()
        self._lock = Lock()

    def increment(self, name: str) -> None:
        with self._lock:
            self._counts[name] += 1

    def snapshot(self) -> dict[str, int]:
        with self._lock:
            return dict(self._counts)
