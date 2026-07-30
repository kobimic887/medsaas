"""The poll loop."""

from __future__ import annotations

import dataclasses
import logging
import threading

from .callback import CallbackError, PlatformCallback
from .predictor import Predictor
from .queue import MAX_ATTEMPTS, Job, JobQueue

logger = logging.getLogger(__name__)


class Worker:
    def __init__(
        self,
        queue: JobQueue,
        predictor: Predictor,
        callback: PlatformCallback,
        *,
        poll_seconds: float = 10.0,
        heartbeat_seconds: float = 30.0,
    ):
        self._queue = queue
        self._predictor = predictor
        self._callback = callback
        self._poll_seconds = poll_seconds
        self._heartbeat_seconds = heartbeat_seconds
        self._stop = threading.Event()

    def stop(self) -> None:
        self._stop.set()

    def run_forever(self) -> None:
        logger.info("ADMET worker started (engine=%s)", getattr(self._predictor, "name", "?"))
        while not self._stop.is_set():
            worked = self.run_once()
            if not worked:
                self._stop.wait(self._poll_seconds)

    def run_once(self) -> bool:
        """One tick. Returns True if a job was processed, so the caller can skip the sleep."""
        self._queue.reap_stale()

        job = self._queue.claim()
        if job is None:
            return False

        logger.info("claimed %s (attempt %d, %d smiles)", job.simulation_key, job.attempts, len(job.smiles))

        if not job.smiles:
            # Not retryable: a job with no molecules will never succeed, so burning two more
            # attempts on it only delays the operator finding out why. Forcing the attempt
            # count past the cap is how `fail` is told to park rather than requeue.
            self._queue.fail(
                dataclasses.replace(job, attempts=MAX_ATTEMPTS), "job carries no SMILES"
            )
            return True

        beat = self._start_heartbeat(job)
        try:
            result = self._predictor.predict(job.smiles)
            self._callback.send(job.simulation_key, result)
        except CallbackError as exc:
            status = self._queue.fail(job, str(exc))
            logger.error("callback failed for %s -> %s: %s", job.simulation_key, status, exc)
            return True
        except Exception as exc:  # noqa: BLE001 - a model failure must not kill the loop
            status = self._queue.fail(job, f"{type(exc).__name__}: {exc}")
            logger.exception("prediction failed for %s -> %s", job.simulation_key, status)
            return True
        finally:
            beat.set()

        self._queue.complete(job, result)
        logger.info("completed %s", job.simulation_key)
        return True

    def _start_heartbeat(self, job: Job) -> threading.Event:
        finished = threading.Event()

        def pulse() -> None:
            while not finished.wait(self._heartbeat_seconds):
                try:
                    self._queue.heartbeat(job)
                except Exception:  # noqa: BLE001 - a failed heartbeat must not abort the job
                    logger.warning("heartbeat failed for %s", job.simulation_key, exc_info=True)

        thread = threading.Thread(target=pulse, name=f"heartbeat-{job.simulation_key}", daemon=True)
        thread.start()
        return finished


__all__ = ["Worker"]
