from __future__ import annotations

from datetime import timedelta

import pytest

from admet_worker.queue import (
    ERROR,
    JobQueue,
    MAX_ATTEMPTS,
    QUEUED,
    RUNNING,
    utcnow,
)

from .fake_mongo import FakeCollection, FakeDatabase


@pytest.fixture()
def collection() -> FakeCollection:
    return FakeCollection()


@pytest.fixture()
def queue(collection: FakeCollection) -> JobQueue:
    return JobQueue(FakeDatabase(collection), worker_id="test:1")


def _queued(collection: FakeCollection, key="sim1", smiles=("CCO",), attempts=0):
    return collection.insert(
        simulationKey=key,
        smiles=list(smiles),
        status=QUEUED,
        attempts=attempts,
        createdAt=utcnow(),
        startedAt=None,
        heartbeatAt=None,
        workerId=None,
    )


def test_claim_returns_none_on_an_empty_queue(queue: JobQueue) -> None:
    assert queue.claim() is None


def test_claim_marks_running_and_counts_the_attempt(queue, collection) -> None:
    _queued(collection)
    job = queue.claim()

    assert job is not None
    assert job.simulation_key == "sim1"
    assert job.attempts == 1

    stored = collection.by_key("sim1")
    assert stored["status"] == RUNNING
    assert stored["workerId"] == "test:1"
    assert stored["heartbeatAt"] is not None


def test_two_workers_cannot_claim_the_same_job(collection) -> None:
    """The status is in the FILTER, so the loser's filter stops matching."""
    _queued(collection)
    first = JobQueue(FakeDatabase(collection), "worker-a")
    second = JobQueue(FakeDatabase(collection), "worker-b")

    assert first.claim() is not None
    assert second.claim() is None


def test_claims_take_the_oldest_job_first(queue, collection) -> None:
    old = _queued(collection, key="old")
    new = _queued(collection, key="new")
    old["createdAt"] = utcnow() - timedelta(hours=2)
    new["createdAt"] = utcnow()

    assert queue.claim().simulation_key == "old"


def test_failure_requeues_until_the_cap_then_parks(queue, collection) -> None:
    _queued(collection)
    for attempt in range(1, MAX_ATTEMPTS + 1):
        job = queue.claim()
        assert job is not None, f"job should be claimable on attempt {attempt}"
        status = queue.fail(job, f"boom {attempt}")
        expected = ERROR if attempt >= MAX_ATTEMPTS else QUEUED
        assert status == expected

    stored = collection.by_key("sim1")
    assert stored["status"] == ERROR
    assert stored["error"] == f"boom {MAX_ATTEMPTS}"
    assert stored["finishedAt"] is not None
    # And it must stay parked — never retry forever silently.
    assert queue.claim() is None


def test_complete_records_the_result(queue, collection) -> None:
    _queued(collection)
    job = queue.claim()
    queue.complete(job, {"engine": "stub", "value": 1})

    stored = collection.by_key("sim1")
    assert stored["status"] == "done"
    assert stored["result"] == {"engine": "stub", "value": 1}
    assert stored["error"] is None


def test_heartbeat_only_touches_a_running_job(queue, collection) -> None:
    _queued(collection)
    job = queue.claim()
    before = collection.by_key("sim1")["heartbeatAt"]

    queue.heartbeat(job)
    assert collection.by_key("sim1")["heartbeatAt"] >= before

    queue.complete(job, {})
    finished_beat = collection.by_key("sim1")["heartbeatAt"]
    queue.heartbeat(job)
    assert collection.by_key("sim1")["heartbeatAt"] == finished_beat


def test_a_job_abandoned_by_a_dead_worker_is_requeued(queue, collection) -> None:
    """The exact failure this rewrite exists to make visible."""
    document = _queued(collection)
    job = queue.claim()
    assert job is not None
    document["heartbeatAt"] = utcnow() - timedelta(hours=1)

    assert queue.reap_stale() == 1
    stored = collection.by_key("sim1")
    assert stored["status"] == QUEUED
    assert stored["workerId"] is None
    assert queue.claim() is not None


def test_a_job_that_keeps_being_abandoned_is_parked_not_requeued(queue, collection) -> None:
    document = _queued(collection, attempts=MAX_ATTEMPTS - 1)
    queue.claim()  # attempts -> MAX_ATTEMPTS
    document["heartbeatAt"] = utcnow() - timedelta(hours=1)

    assert queue.reap_stale() == 1
    stored = collection.by_key("sim1")
    assert stored["status"] == ERROR
    assert "abandoned" in stored["error"]


def test_a_healthy_running_job_is_left_alone(queue, collection) -> None:
    _queued(collection)
    queue.claim()
    assert queue.reap_stale() == 0
    assert collection.by_key("sim1")["status"] == RUNNING


def test_reaping_never_touches_a_job_that_is_merely_old_and_queued(queue, collection) -> None:
    document = _queued(collection)
    document["createdAt"] = utcnow() - timedelta(days=30)
    assert queue.reap_stale() == 0
    assert collection.by_key("sim1")["status"] == QUEUED
