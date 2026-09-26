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
| `CONVERTSTR_URL` | unset | Optional SMILES conversion endpoint |

The application normally converts SMILES before submitting SDF. If a caller sends SMILES
directly, the optional converter must be configured. Keep service access restricted through
[ingress](../ingress/README.md); use [operations](../../../docs/OPERATIONS.md) for deployment records.
