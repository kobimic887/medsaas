"""The Mongo job queue, from the worker's side.

Deliberately free of any ADMET or model import, so the whole claim/heartbeat/finish
protocol is testable without downloading a 2 GB model or owning a GPU.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import logging
from typing import Any

logger = logging.getLogger(__name__)

COLLECTION = "admet_jobs"

QUEUED = "queued"
RUNNING = "running"
DONE = "done"
ERROR = "error"

# Must match server/utils/admetQueue.js. Both sides are asserted against these numbers in
# their own test suites; if you change one, change the other.
MAX_ATTEMPTS = 3

# Delay before a failed job may be claimed again, indexed by attempt number. Mirrors
# ADMET_RETRY_BACKOFF_MS on the Node side.
#
# Without it, `fail()` requeues and `run_once` returns True, so the loop skips its poll wait
# and re-claims the very same job immediately: a 20-second `systemctl restart pyxis-web` on
# 83 would burn all three attempts — and three complete GPU predictions — inside one restart
# window, then park the job in `error`.
RETRY_BACKOFF_SECONDS = [30, 300, 900]
STALE_AFTER_SECONDS = 15 * 60


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


@dataclass(frozen=True)
class Job:
    id: Any
    simulation_key: str
    smiles: list[str]
    attempts: int
    pdbid: str | None = None

    @classmethod
    def from_document(cls, document: dict) -> Job:
        raw = document.get("smiles") or []
        if isinstance(raw, str):
            raw = [raw]
        smiles = [str(entry).strip() for entry in raw if str(entry).strip()]
        return cls(
            id=document["_id"],
            simulation_key=str(document.get("simulationKey") or ""),
            smiles=smiles,
            attempts=int(document.get("attempts") or 0),
            pdbid=document.get("pdbid"),
        )


class JobQueue:
    """Claim-and-finish over a single Mongo collection.

    The queue is deliberately boring. The workload is four docking results in three months;
    what matters is not throughput but that a stuck job is VISIBLE, which is exactly what
    the RabbitMQ version could not do.
    """

    def __init__(self, database, worker_id: str, *, stale_after_seconds: int = STALE_AFTER_SECONDS):
        self._jobs = database[COLLECTION]
        self._worker_id = worker_id
        self._stale_after = stale_after_seconds

    # ── claiming ─────────────────────────────────────────────────────────────

    def claim(self) -> Job | None:
        """Take one queued job, atomically.

        `find_one_and_update` with the status in the FILTER is what makes this safe: two
        workers racing on the same document produce one winner and one None, because the
        loser's filter no longer matches by the time its update applies.
        """
        now = utcnow()
        document = self._jobs.find_one_and_update(
            # `availableAt` in the past, or absent entirely — the second clause matters
            # because rows written before backoff existed have no such field, and a filter
            # that required one would quietly stop claiming them.
            {
                "status": QUEUED,
                "$or": [{"availableAt": {"$lt": now}}, {"availableAt": None}],
            },
            {
                "$set": {
                    "status": RUNNING,
                    "startedAt": now,
                    "heartbeatAt": now,
                    "updatedAt": now,
                    "workerId": self._worker_id,
                },
                "$inc": {"attempts": 1},
            },
            sort=[("createdAt", 1)],
            return_document=True,
        )
        if document is None:
            return None
        return Job.from_document(document)

    # ── progress ─────────────────────────────────────────────────────────────

    def heartbeat(self, job: Job) -> None:
        """Say the worker is still alive.

        Without this, a job killed mid-prediction sits in `running` forever — the failure
        mode this whole rewrite exists to make visible. Do not skip it for short jobs; the
        first ADMET run downloads and warms a model and is not short.
        """
        now = utcnow()
        self._jobs.update_one(
            {"_id": job.id, "status": RUNNING},
            {"$set": {"heartbeatAt": now, "updatedAt": now}},
        )

    def complete(self, job: Job, result: dict) -> str:
        """Record a finished prediction — but only if this worker still owns the job.

        ⚠ The filter is not decoration. A job can stop being ours mid-prediction: the reaper
        can take it back after a missed heartbeat, or an operator can clear it through
        DELETE /api/simulation/:key/admet. Without `workerId` in the filter this worker would
        then write its stale result over the fresh state and mark it done — silently undoing
        exactly the reset that was just requested. Losing the write is the correct outcome.
        """
        now = utcnow()
        outcome = self._jobs.update_one(
            {"_id": job.id, "status": RUNNING, "workerId": self._worker_id},
            {
                "$set": {
                    "status": DONE,
                    "result": result,
                    "error": None,
                    "finishedAt": now,
                    "updatedAt": now,
                }
            },
        )
        if getattr(outcome, "modified_count", 0):
            return DONE
        logger.warning(
            "job %s was taken away mid-prediction; result discarded rather than overwriting",
            job.simulation_key,
        )
        return "lost"

    def fail(self, job: Job, message: str) -> str:
        """Requeue for another attempt, or park in `error` when attempts run out.

        Returns the status the job ended up in, so the caller can log the difference
        between "will retry" and "gave up".
        """
        now = utcnow()
        exhausted = job.attempts >= MAX_ATTEMPTS
        status = ERROR if exhausted else QUEUED
        update: dict[str, Any] = {
            "status": status,
            "error": message[:2000],
            "updatedAt": now,
            "workerId": None,
            "heartbeatAt": None,
        }
        if exhausted:
            update["finishedAt"] = now
        else:
            index = min(max(job.attempts - 1, 0), len(RETRY_BACKOFF_SECONDS) - 1)
            update["availableAt"] = now + timedelta(seconds=RETRY_BACKOFF_SECONDS[index])
        self._jobs.update_one({"_id": job.id}, {"$set": update})
        return status

    # ── housekeeping ─────────────────────────────────────────────────────────

    def reap_stale(self) -> int:
        """Return jobs abandoned by a dead worker to the queue.

        A worker that crashes leaves `running` behind. Every worker reaps on each poll, so
        recovery does not depend on anyone visiting an admin page.
        """
        cutoff = utcnow() - timedelta(seconds=self._stale_after)
        stale = list(
            self._jobs.find(
                {
                    "status": RUNNING,
                    "$or": [
                        {"heartbeatAt": {"$lt": cutoff}},
                        {"heartbeatAt": None, "startedAt": {"$lt": cutoff}},
                    ],
                }
            )
        )

        recovered = 0
        for document in stale:
            job = Job.from_document(document)
            exhausted = job.attempts >= MAX_ATTEMPTS
            now = utcnow()
            update: dict[str, Any] = {
                "status": ERROR if exhausted else QUEUED,
                "workerId": None,
                "heartbeatAt": None,
                "updatedAt": now,
            }
            if not exhausted:
                index = min(max(job.attempts - 1, 0), len(RETRY_BACKOFF_SECONDS) - 1)
                update["availableAt"] = now + timedelta(seconds=RETRY_BACKOFF_SECONDS[index])
            if exhausted:
                update["error"] = f"abandoned after {job.attempts} attempts — worker stopped responding"
                update["finishedAt"] = now
            result = self._jobs.update_one(
                {"_id": job.id, "status": RUNNING}, {"$set": update}
            )
            if getattr(result, "modified_count", 0):
                recovered += 1
                logger.warning(
                    "reaped stale job %s (attempt %d) -> %s",
                    job.simulation_key,
                    job.attempts,
                    update["status"],
                )
        return recovered
