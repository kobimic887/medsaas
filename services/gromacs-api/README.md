# GROMACS API

FastAPI wrapper for GROMACS commands, molecular-dynamics workflows, input files,
and asynchronous jobs. The Docker image includes a CUDA-enabled GROMACS build.

This service has no built-in authentication and can run commands and manage
files. Keep direct access local or behind an authenticated application proxy.

## Run on a GPU development host

The [Dockerfile](Dockerfile) targets x86_64, CUDA 12.8, and `sm_120`. Build on a
compatible host with Docker; running with `--gpus all` requires NVIDIA container
support and compatible hardware.

From the repository root:

```bash
docker build -t pyxis-gromacs services/gromacs-api
docker run --rm --gpus all \
  -p 127.0.0.1:8000:8000 \
  -v pyxis-gromacs-data:/data \
  pyxis-gromacs
```

Use a persistent volume for input files, results, job metadata, and templates.
The image provides templates in `/data/.templates`; a bind mount over `/data`
hides them unless that directory is populated in the mount.

Once running, [Swagger UI](http://localhost:8000/docs) provides the complete API
schema and interactive requests. `GET /health` and `GET /gromacs/version` report
service and GROMACS status.

## Example workflow

Upload a local PDB file, then start topology generation. **Workflow parameters
are query parameters**; the generic command endpoints accept JSON bodies.

```bash
curl --fail-with-body http://localhost:8000/files/upload \
  -F 'file=@protein.pdb'

curl --fail-with-body -X POST \
  'http://localhost:8000/workflows/pdb2gmx?pdb_file=protein.pdb&force_field=oplsaa&water=spce&output_prefix=processed'
```

Use the returned `job_id` to poll `GET /jobs/{job_id}`. After the job completes,
download outputs from `/files/download/processed.gro` and
`/files/download/processed.top`. Inspect failed-job details and
`GET /jobs/{job_id}/logs` when a command fails.

For a synchronous command:

```bash
curl --fail-with-body http://localhost:8000/gromacs/execute/sync \
  -H 'Content-Type: application/json' \
  -d '{"command":"editconf","args":["-f","processed.gro","-o","boxed.gro","-bt","cubic","-d","1.0"],"working_dir":"."}'
```

The [Python client example](examples_python_client.py) implements upload, workflow
submission, polling, and download calls.

## API areas

| Path family | Purpose |
|---|---|
| `/files/*` | Upload, list, view, download, and delete files |
| `/gromacs/*` | Run commands asynchronously or synchronously; inspect version and help |
| `/jobs/*` | List jobs, inspect status and logs, cancel or delete jobs |
| `/workflows/*` | `pdb2gmx`, `editconf`, `solvate`, `genion`, `grompp`, `mdrun`, `energy`, `trjconv` |
| `/templates/*` | List, read, and create MDP templates |
| `/workspaces/*` | Create, list, and delete working directories |
| `/health`, `/info`, `/metrics` | Service health, configuration, and resource usage |

Included MDP templates cover energy minimization (`em.mdp`), NVT (`nvt.mdp`),
NPT (`npt.mdp`), and production dynamics (`md.mdp`). Review their parameters for
the intended simulation before use.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `WORK_DIR` | `/data` | Files, `.jobs.json`, job logs, and `.templates` |
| `MAX_UPLOAD_SIZE` | `104857600` | Maximum upload size in bytes |
| `JOB_TIMEOUT` | `3600` | Command timeout in seconds |

For development with an existing Python environment and GROMACS installation,
run `python app.py` from this directory after installing [requirements.txt](requirements.txt).
`gmx` must be on `PATH` and `WORK_DIR` must be writable. The API implementation
is in [app.py](app.py).
