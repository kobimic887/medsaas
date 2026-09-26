# Compute services

The shared [`compose.yml`](compose.yml) describes scientific services, not the web application.
Start and qualify one service at a time. Current host identities and release records belong
in [operations](../../docs/OPERATIONS.md).

| Service | Source and contract | Acceptance focus |
|---|---|---|
| Docking | [service README](docking/service/README.md), [requirements](docking/BRIEF.md) | Real engine, prepared receptor and parser-compatible PDB/SDF |
| convertSTR | [README](convertstr/README.md) | Valid reproducible 3D SDF and readable input failures |
| DiffDock | [README](diffdock/README.md) | Dependencies, model weights, real inference and compatible failure envelope |
| Tanimoto | External image selected by `TANIMOTO_IMAGE` | Restored datasets, RDKit support and search parity |
| ADMET | `services/admet/` | Mongo job lifecycle, model output and authenticated callback |
| GROMACS | `services/gromacs-api/` | Representative simulation and persistent job files |
| Glioblastoma | `services/glioblastoma-predictor/` | Model assets and representative prediction |

## Configuration traps

- Compose does not build the external Tanimoto image. Supply an appropriate image and verify
  the RDKit extension in both the API/runtime and database where required.
- `DOCKING_ENGINE` falls back to `autodock-gpu` in Compose, but that engine deliberately
  returns 503. The example environment selects `vina`; choose it explicitly for CPU docking.
- DiffDock's runtime selects `oss` and needs model weights mounted at `/models`.
  Replay engines are fixtures and cannot qualify a live service.
- GPU reservations use explicit device IDs. Several optional services share a device;
  verify the actual assignments and behavior under representative concurrency.
- ADMET, GROMACS and glioblastoma are under the `extras` profile. ADMET requires MongoDB
  Atlas access; it is a worker using a Mongo job collection, not a RabbitMQ consumer.
- Container ports bind to loopback by default. Retain that boundary and validate
  [HTTPS ingress](ingress/README.md) from allowed and disallowed clients.

Use [the cutover checklist](../../docs/ARRIVAL-RUNBOOK.md) to validate and change application
settings one at a time. Do not infer current deployment status from this Compose file.
