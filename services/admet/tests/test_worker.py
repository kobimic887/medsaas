from __future__ import annotations

from datetime import timedelta

import pytest

from admet_worker.callback import CallbackError, PlatformCallback
from admet_worker.predictor import StubPredictor, create_predictor
from admet_worker.queue import ERROR, JobQueue, MAX_ATTEMPTS, QUEUED, utcnow
from admet_worker.worker import Worker

from .fake_mongo import FakeCollection, FakeDatabase


class RecordingCallback:
    def __init__(self, *, fail_with: str | None = None) -> None:
        self.sent: list[tuple[str, dict]] = []
        self._fail_with = fail_with

    def send(self, simulation_key: str, admet: dict) -> None:
        if self._fail_with:
            raise CallbackError(self._fail_with)
        self.sent.append((simulation_key, admet))


class ExplodingPredictor:
    name = "exploding"

    def predict(self, smiles):
        raise RuntimeError("model went missing")


@pytest.fixture()
def collection() -> FakeCollection:
    return FakeCollection()


def _worker(collection, predictor=None, callback=None) -> tuple[Worker, RecordingCallback]:
    recorder = callback or RecordingCallback()
    worker = Worker(
        JobQueue(FakeDatabase(collection), "test:1"),
        predictor or StubPredictor(),
        recorder,
        poll_seconds=0.01,
        heartbeat_seconds=0.01,
    )
    return worker, recorder


def _queued(collection, key="sim1", smiles=("CCO",), attempts=0):
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


def test_an_empty_queue_is_not_work(collection) -> None:
    worker, _ = _worker(collection)
    assert worker.run_once() is False


def test_a_job_is_predicted_delivered_and_marked_done(collection) -> None:
    _queued(collection, smiles=("CCO", "CCN"))
    worker, recorder = _worker(collection)

    assert worker.run_once() is True

    assert len(recorder.sent) == 1
    key, payload = recorder.sent[0]
    assert key == "sim1"
    assert payload["engine"] == "stub"
    # Flat first — the dashboard reads simulation.admet as a property bag, so a payload
    # that only had a `compounds` array would render every field as "N/A" with no error.
    assert payload["molecular_weight"] == 3.0
    assert [c["smiles"] for c in payload["compounds"]] == ["CCO", "CCN"]

    stored = collection.by_key("sim1")
    assert stored["status"] == "done"
    assert stored["result"] == payload


def test_a_single_compound_result_carries_no_compounds_array(collection) -> None:
    _queued(collection, smiles=("CCO",))
    worker, recorder = _worker(collection)
    worker.run_once()

    _, payload = recorder.sent[0]
    assert payload["molecular_weight"] == 3.0
    assert "compounds" not in payload


def test_a_prediction_crash_requeues_rather_than_killing_the_loop(collection) -> None:
    _queued(collection)
    worker, _ = _worker(collection, predictor=ExplodingPredictor())

    assert worker.run_once() is True
    stored = collection.by_key("sim1")
    assert stored["status"] == QUEUED
    assert "model went missing" in stored["error"]


def test_a_rejected_callback_does_not_mark_the_job_done(collection) -> None:
    """The prediction succeeded; the platform never got it. That is not `done`."""
    _queued(collection)
    worker, _ = _worker(collection, callback=RecordingCallback(fail_with="callback returned 401"))

    worker.run_once()
    stored = collection.by_key("sim1")
    assert stored["status"] == QUEUED
    assert "401" in stored["error"]


def test_a_job_with_no_molecules_is_parked_immediately(collection) -> None:
    _queued(collection, smiles=())
    worker, recorder = _worker(collection)

    assert worker.run_once() is True
    stored = collection.by_key("sim1")
    assert stored["status"] == ERROR
    assert stored["error"] == "job carries no SMILES"
    assert recorder.sent == []


def test_a_job_abandoned_by_a_previous_worker_is_picked_up(collection) -> None:
    document = _queued(collection)
    document.update(status="running", startedAt=utcnow() - timedelta(hours=2), heartbeatAt=None, attempts=1)

    worker, recorder = _worker(collection)

    # First tick reaps it back to `queued` with a backoff; it is not claimable yet.
    assert worker.run_once() is False
    assert collection.by_key("sim1")["status"] == QUEUED

    document["availableAt"] = utcnow() - timedelta(seconds=1)
    assert worker.run_once() is True
    assert recorder.sent[0][0] == "sim1"
    assert collection.by_key("sim1")["status"] == "done"


def test_a_failed_job_is_not_re_claimed_immediately(collection) -> None:
    """A 20-second restart on 84 must not burn all three attempts.

    `fail` requeues and `run_once` returns True, so the loop skips its poll wait and comes
    straight back round. Without a backoff the same job — and the same full GPU prediction —
    would be retried three times inside one restart window.
    """
    _queued(collection)
    worker, _ = _worker(collection, predictor=ExplodingPredictor())

    assert worker.run_once() is True
    stored = collection.by_key("sim1")
    assert stored["status"] == QUEUED
    assert stored["availableAt"] > utcnow()

    # Immediately afterwards there is nothing claimable.
    assert worker.run_once() is False
    assert collection.by_key("sim1")["attempts"] == 1


def test_repeated_failure_eventually_parks(collection) -> None:
    document = _queued(collection)
    worker, _ = _worker(collection, predictor=ExplodingPredictor())

    for _ in range(MAX_ATTEMPTS):
        assert worker.run_once() is True
        # Stand in for waiting out the backoff.
        document["availableAt"] = utcnow() - timedelta(seconds=1)

    assert collection.by_key("sim1")["status"] == ERROR
    assert worker.run_once() is False


# ── the pieces around the loop ───────────────────────────────────────────────


def test_callback_url_shape_matches_the_platform_route() -> None:
    callback = PlatformCallback("https://app.pyxis-discovery.com/", "s" * 16)
    assert callback.url_for("abc123") == "https://app.pyxis-discovery.com/api/simulation/abc123/admet"


def test_a_worker_without_a_secret_refuses_to_start() -> None:
    """Better than claiming work it could never deliver, after the GPU time is spent."""
    with pytest.raises(ValueError, match="ADMET_CALLBACK_SECRET"):
        PlatformCallback("https://example.test", "")


def test_a_worker_without_a_callback_url_refuses_to_start() -> None:
    with pytest.raises(ValueError, match="ADMET_CALLBACK_URL"):
        PlatformCallback("", "secret")


def test_unknown_engine_is_rejected_by_name() -> None:
    with pytest.raises(ValueError, match="ADMET_ENGINE"):
        create_predictor("gpu-please")
