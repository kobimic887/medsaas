# DiffDock compatibility service

This service wraps OSS DiffDock behind the request/response contract consumed by Pyxis.
It exposes `POST /molecular-docking/diffdock/generate` and `GET /health`.
The application selects it with `DIFFDOCK_API_URL`; retain the full generation path.

## Response semantics

- A chemistry failure can return HTTP `200` with `status: "failed"`. Check the envelope,
  not only the HTTP status. Structurally invalid requests return `400`.
- Pose, confidence and trajectory arrays are padded to the requested pose count. Empty
  strings and nulls are padding, not successful poses.
- Confidence values are sorted best-first and stay aligned with ligand positions by index.
- `protein` and `ligand` are echoed exactly as supplied. Parsing accepts raw newlines,
  literal escaped newlines and backslash/newline forms without rewriting the echo.

[Reference fixtures](reference/README.md) define the envelope, escaping and failure cases.

## Engines

| `DIFFDOCK_ENGINE` | Behavior |
|---|---|
| `replay` | Fixture poses; default in the Python wrapper and test image; no inference |
| `oss` | Pinned upstream DiffDock subprocess; selected by the runtime image and Compose |

The runtime Dockerfile pins the upstream checkout through `DIFFDOCK_REF`. It uses the
open-source engine, not a licensed NIM container. Hardware and dependency compatibility
must be qualified on the target GPU host.

| Request field | Upstream flag |
|---|---|
| `time_divisions` | `--inference_steps` |
| `steps` | `--actual_steps` |
| `num_poses` | `--samples_per_complex` |

The OSS adapter reads confidence from output filenames, which carry two decimal places.
Its displayed values can therefore have less precision than the reference response.

## Verify and build

From the repository root on an appropriate Docker host:

```bash
docker build --target test -t pyxis-diffdock-test deploy/box/diffdock
docker run --rm --network none pyxis-diffdock-test
```

The wrapper tests exercise envelopes, normalization, pose collection and adapter arguments.
They do not run model inference. Build the CUDA runtime on a compatible x86_64 Docker host,
provide the operator-managed environment, and populate the model directory using
[`fetch-weights.sh`](fetch-weights.sh) before starting the real service. Compose mounts
`/srv/models/diffdock` read-only at `/models`.

Run `python -m diffdock_service preflight` inside the configured runtime image, then submit
a full valid protein/SDF request to the real engine. The canonical request fixture has a
truncated protein and is not a complete scientific inference input. Verify GPU assignment,
usable poses, confidence alignment, latency and the application viewer.

## Configuration

| Variable | Wrapper default | Purpose |
|---|---|---|
| `DIFFDOCK_ENGINE` | `replay` | Selected engine; runtime image sets `oss` |
| `DIFFDOCK_REPO_DIR` | `/opt/diffdock` | Upstream checkout |
| `DIFFDOCK_MODEL_DIR` | `/models` | Model weights |
| `DIFFDOCK_WORK_DIR` | `/tmp/diffdock` | Per-request scratch directories |
| `DIFFDOCK_TIMEOUT_SECONDS` | `540` | Inference deadline |
| `DIFFDOCK_MAX_POSES` | `100` | Requested-pose clamp |
| `DIFFDOCK_BATCH_SIZE` | `10` | Inference batch size |
| `DIFFDOCK_REQUIRE_CUDA` | `false` | Refuse CPU fallback; enabled by workstation Compose |
| `CONVERTSTR_URL` | unset | Optional SMILES conversion endpoint |

The separate application setting `DIFFDOCK_NUM_POSES` controls the actual request
(1–100, default 100). Match it to the qualified workload; the application rejects
incomplete or padded output and refunds failed inference. A service clamp is not
a substitute for an explicitly approved smaller application request.

Each service process admits one inference at a time. Overlapping generation
requests receive `503 DIFFDOCK_BUSY` immediately, with `Retry-After: 10`; the
application refunds these and displays a retry message. Run one service worker
per GPU unless a different concurrency limit has been qualified. A deadline kills
the request's subprocess group, including preprocessing children. INFO logs record
request IDs, start/completion, elapsed time and pose counts without molecular bodies.

With `DIFFDOCK_REQUIRE_CUDA=true`, the inference process proves a CUDA operation
before loading models. A lost GPU context fails the request instead of using CPU.
`/health` checks engine assets; a 200 still does not prove CUDA or real inference.

The application normally converts SMILES before submitting SDF. If a caller sends SMILES
directly, the optional converter must be configured. Keep service access restricted through
[ingress](../ingress/README.md); use [operations](../../../docs/OPERATIONS.md) for deployment records.

## Runtime preparation traps

Upstream applies YAML after CLI parsing. The adapter writes a per-request effective
YAML so requested pose counts, steps and `/models` paths survive that merge while
retaining the pinned scientific settings and checkpoint filenames. Preflight rejects
missing/empty checkpoint files rather than accepting any nonempty directory.

PDB inference still imports `fair-esm` and computes ESM2 embeddings. The runtime
includes it, compatible ProDy/Biopython pins, and a build-time upstream import check.
Prepare the ESM cache before serving with [`prepare-embeddings.py`](prepare-embeddings.py).
Only trusted pinned upstream checkpoints are allowed; the runtime explicitly enables
legacy loading for PyTorch 2.7. This is a preparation fix, not GPU qualification.

For the single-GPU workstation use [the 3060 preparation checklist](../WORKSTATION-3060.md).
