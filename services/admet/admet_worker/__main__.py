"""Entrypoint. `python -m admet_worker`"""

from __future__ import annotations

import argparse
import logging
import os
import signal
import socket
import sys

from .callback import PlatformCallback
from .predictor import create_predictor
from .queue import JobQueue, STALE_AFTER_SECONDS
from .worker import Worker


def _float_env(name: str, default: float) -> float:
    raw = os.environ.get(name)
    if not raw:
        return default
    try:
        return float(raw)
    except ValueError:
        return default


def report_accelerator() -> None:
    """Say out loud whether this worker is on a GPU.

    The build asserts the cu128 torch survived installation, but it cannot assert
    availability — there is no GPU during a docker build. This is the other half: a worker
    that quietly fell back to CPU is not an error, it is just permanently slow, and the only
    way anyone finds out is if it says so on every start.
    """
    logger = logging.getLogger(__name__)
    try:
        import torch
    except ImportError:
        logger.info("torch is not installed — stub engine only")
        return

    if torch.cuda.is_available():
        logger.info("CUDA available: %s (torch %s)", torch.cuda.get_device_name(0), torch.__version__)
    else:
        logger.warning(
            "CUDA NOT available — predictions will run on the CPU (torch %s)", torch.__version__
        )


def build_worker():
    from pymongo import MongoClient

    mongodb_uri = os.environ.get("MONGODB_URI")
    if not mongodb_uri:
        raise SystemExit("MONGODB_URI is required")

    client = MongoClient(mongodb_uri, serverSelectionTimeoutMS=10_000)
    database = client.get_default_database()
    if database is None:
        # Atlas URIs in this project carry the database name; if one does not, say so
        # rather than silently polling the wrong place.
        raise SystemExit("MONGODB_URI must name a database")

    worker_id = f"{socket.gethostname()}:{os.getpid()}"
    queue = JobQueue(
        database,
        worker_id,
        stale_after_seconds=int(_float_env("ADMET_STALE_AFTER_SECONDS", STALE_AFTER_SECONDS)),
    )
    predictor = create_predictor(os.environ.get("ADMET_ENGINE") or "admet-ai")
    callback = PlatformCallback(
        os.environ.get("ADMET_CALLBACK_URL", ""),
        os.environ.get("ADMET_CALLBACK_SECRET", ""),
    )

    return Worker(
        queue,
        predictor,
        callback,
        poll_seconds=_float_env("ADMET_POLL_SECONDS", 10.0),
        heartbeat_seconds=_float_env("ADMET_HEARTBEAT_SECONDS", 30.0),
    )


def main() -> None:
    parser = argparse.ArgumentParser(prog="admet-worker")
    parser.add_argument(
        "--once",
        action="store_true",
        help="process at most one job and exit — for a smoke test on the box",
    )
    arguments = parser.parse_args()

    logging.basicConfig(
        level=os.environ.get("LOG_LEVEL", "INFO"),
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )

    report_accelerator()
    worker = build_worker()

    if arguments.once:
        processed = worker.run_once()
        print("processed one job" if processed else "queue was empty")
        return

    def handle_signal(signum, _frame):
        logging.getLogger(__name__).info("received signal %s, finishing current job", signum)
        worker.stop()

    signal.signal(signal.SIGTERM, handle_signal)
    signal.signal(signal.SIGINT, handle_signal)

    try:
        worker.run_forever()
    except KeyboardInterrupt:
        pass
    sys.exit(0)


if __name__ == "__main__":
    main()
