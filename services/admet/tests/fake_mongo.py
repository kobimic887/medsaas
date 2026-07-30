"""A minimal in-memory stand-in for the one Mongo collection the worker uses.

Not a general Mongo emulator — it implements exactly the operators this worker issues, and
it enforces the property the worker's correctness rests on: `find_one_and_update` matches
the filter and applies the update as ONE step, so two callers racing on the same document
produce one winner. A test double that did not would let a broken claim() pass.
"""

from __future__ import annotations

from datetime import datetime
import itertools
import threading
from typing import Any


class _UpdateResult:
    def __init__(self, modified_count: int) -> None:
        self.modified_count = modified_count
        self.matched_count = modified_count


def _matches(document: dict, condition: Any, key: str | None = None) -> bool:
    if key == "$or":
        return any(_matches_all(document, clause) for clause in condition)

    actual = document.get(key)

    if isinstance(condition, dict):
        for operator, operand in condition.items():
            if operator == "$lt":
                if actual is None or not _lt(actual, operand):
                    return False
            elif operator == "$gte":
                if actual is None or _lt(actual, operand):
                    return False
            else:
                raise NotImplementedError(f"operator {operator} is not supported by the fake")
        return True

    return actual == condition


def _lt(left: Any, right: Any) -> bool:
    if isinstance(left, datetime) and isinstance(right, datetime):
        if (left.tzinfo is None) != (right.tzinfo is None):
            raise AssertionError(
                "naive/aware datetime comparison — real Mongo stores UTC and the worker "
                "must not mix them"
            )
    return left < right


def _matches_all(document: dict, query: dict) -> bool:
    return all(_matches(document, condition, key) for key, condition in query.items())


class FakeCollection:
    def __init__(self) -> None:
        self._documents: list[dict] = []
        self._ids = itertools.count(1)
        self._lock = threading.Lock()
        self.calls: list[str] = []

    # ── helpers used by tests, not by the worker ─────────────────────────────

    def insert(self, **fields) -> dict:
        document = {"_id": next(self._ids), **fields}
        self._documents.append(document)
        return document

    def all(self) -> list[dict]:
        return [dict(document) for document in self._documents]

    def by_key(self, simulation_key: str) -> dict:
        for document in self._documents:
            if document.get("simulationKey") == simulation_key:
                return dict(document)
        raise KeyError(simulation_key)

    # ── the surface the worker actually uses ─────────────────────────────────

    def find_one_and_update(self, filter, update, sort=None, return_document=True):
        self.calls.append("find_one_and_update")
        with self._lock:
            candidates = [d for d in self._documents if _matches_all(d, filter)]
            if sort:
                for field, direction in reversed(sort):
                    candidates.sort(key=lambda d: d.get(field), reverse=direction < 0)
            if not candidates:
                return None
            document = candidates[0]
            self._apply(document, update)
            return dict(document)

    def update_one(self, filter, update):
        self.calls.append("update_one")
        with self._lock:
            for document in self._documents:
                if _matches_all(document, filter):
                    self._apply(document, update)
                    return _UpdateResult(1)
            return _UpdateResult(0)

    def find(self, filter):
        self.calls.append("find")
        with self._lock:
            return [dict(d) for d in self._documents if _matches_all(d, filter)]

    @staticmethod
    def _apply(document: dict, update: dict) -> None:
        for key, value in update.get("$set", {}).items():
            document[key] = value
        for key, value in update.get("$inc", {}).items():
            document[key] = (document.get(key) or 0) + value


class FakeDatabase(dict):
    def __init__(self, collection: FakeCollection) -> None:
        super().__init__({"admet_jobs": collection})
