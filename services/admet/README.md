# ADMET worker

Background worker that reads compound jobs from MongoDB's `admet_jobs`
collection, predicts ADMET properties, and sends results to the Pyxis API. It
does not expose an HTTP server or require a message broker.

## Job lifecycle

1. Atomically claim an eligible `queued` job and mark it `running`.
2. Send heartbeats while predicting with the selected engine.
3. Deliver `{"admet": ...}` to `PUT /api/simulation/{key}/admet`, authenticated
   with the `x-admet-secret` header.
4. Mark the job `done` after successful delivery, provided the worker still owns it.

Prediction and callback failures retry after a delay, up to three attempts.
Exhausted jobs enter `error`; jobs with no SMILES fail immediately. Stale running
jobs are recovered during polling, with a default heartbeat timeout of 15 minutes.
The platform's `GET /api/rabbitmq/queue-status` route reports queue counts; its
name is retained for compatibility even though storage is MongoDB.

## Configuration

Supply configuration through the worker environment. See [.env.example](.env.example)
for the variable names and placeholders; use the same callback secret as the API.

| Variable | Purpose / default |
|---|---|
| `MONGODB_URI` | Required; must include the application's database name |
| `ADMET_CALLBACK_URL` | Required; base URL of the application API |
| `ADMET_CALLBACK_SECRET` | Required; shared secret sent as `x-admet-secret` |
| `ADMET_ENGINE` | `admet-ai` by default; `stub` for deterministic tests |
| `ADMET_POLL_SECONDS` | Idle poll interval; `10` |
| `ADMET_HEARTBEAT_SECONDS` | Heartbeat interval; `30` |
| `ADMET_STALE_AFTER_SECONDS` | Stale-job threshold; `900` |
| `LOG_LEVEL` | `INFO` |

The worker validates required configuration before claiming jobs. The `stub`
engine returns test values and must not be used for scientific results.

## Tests

From the repository root, build and run the lightweight test target:

```bash
docker build --target test -t pyxis-admet-test services/admet
docker run --rm pyxis-admet-test
```

The tests exercise claims, heartbeats, recovery, retry delays, and callbacks with
an in-memory collection and stub predictor. They do not require a running MongoDB,
GPU, or model, and do not validate model accuracy or GPU execution.

## Runtime

The default Docker target builds the CUDA runtime for an x86_64 GPU host:

```bash
docker build -t pyxis-admet services/admet
```

The container entrypoint is `python -m admet_worker`. Adding `--once` processes at
most one eligible job and exits. It uses the configured database and callback, so
this is real job execution, not a dry run.

Keep the two-pass dependency installation in the [Dockerfile](Dockerfile): CUDA
PyTorch is installed before `admet-ai`, then its build tag and target architecture
are checked. Startup logs report whether CUDA is actually available. An image
build alone does not prove the model will run on a GPU.

## Source

| File | Responsibility |
|---|---|
| [queue.py](admet_worker/queue.py) | Claims, heartbeats, completion, retries, and stale-job recovery |
| [predictor.py](admet_worker/predictor.py) | `admet-ai` and stub engines |
| [callback.py](admet_worker/callback.py) | Result delivery to the application API |
| [worker.py](admet_worker/worker.py) | Poll loop and heartbeat thread |
| [__main__.py](admet_worker/__main__.py) | Configuration, logging, and CLI |
