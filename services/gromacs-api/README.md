# GROMACS API

All-in-one Docker container with GROMACS and REST API for molecular dynamics simulations.

## Features

- 🐳 **Single Docker Image** - GROMACS + API in one container
- 🚀 **Complete REST API** - All GROMACS commands accessible via HTTP
- 📦 **Workflow Endpoints** - Common operations pre-configured
- 📝 **MDP Templates** - Ready-to-use simulation parameter files
- 🔄 **Job Management** - Async execution with status tracking
- 📊 **System Monitoring** - Resource usage and health checks
- 📚 **Interactive Docs** - Swagger UI at `/docs`

## Quick Start

### Using Docker

```bash
# Build the image
docker build -t gromacs-api .

# Run the container
docker run -d -p 8000:8000 -v ./data:/data gromacs-api

# Access the API
curl http://localhost:8000/health
```

### Using Docker Compose

```bash
# Start the service
docker-compose up -d

# View logs
docker-compose logs -f

# Stop the service
docker-compose down
```

## API Documentation

Once running, access the interactive API documentation at:
- **Swagger UI**: http://localhost:8000/docs
- **ReDoc**: http://localhost:8000/redoc

## Usage Examples

### Upload a PDB File

```bash
curl -X POST "http://localhost:8000/files/upload" \
  -F "file=@protein.pdb"
```

### Run pdb2gmx Workflow

```bash
curl -X POST "http://localhost:8000/workflows/pdb2gmx" \
  -H "Content-Type: application/json" \
  -d '{
    "pdb_file": "protein.pdb",
    "force_field": "oplsaa",
    "water": "spce",
    "output_prefix": "processed"
  }'
```

### Check Job Status

```bash
curl "http://localhost:8000/jobs/{job_id}"
```

### Download Results

```bash
curl "http://localhost:8000/files/download/processed.gro" -o processed.gro
```

### Execute Custom GROMACS Command

```bash
curl -X POST "http://localhost:8000/gromacs/execute/sync" \
  -H "Content-Type: application/json" \
  -d '{
    "command": "editconf",
    "args": ["-f", "protein.gro", "-o", "boxed.gro", "-bt", "cubic", "-d", "1.0"],
    "working_dir": "."
  }'
```

## Python Client

See `examples/python_client.py` for a complete Python client implementation.

```python
from python_client import GromacsAPI

api = GromacsAPI("http://localhost:8000")

# Upload file
api.upload_file("protein.pdb")

# Run workflow
job = api.run_workflow("pdb2gmx", pdb_file="protein.pdb")

# Wait for completion
result = api.wait_for_job(job["job_id"])

# Download results
api.download_file("processed.gro", "processed.gro")
```

## Available Workflows

- `pdb2gmx` - Generate topology from PDB
- `editconf` - Define simulation box
- `solvate` - Add solvent
- `genion` - Add ions
- `grompp` - Preprocess MD parameters
- `mdrun` - Run MD simulation
- `energy` - Energy analysis
- `trjconv` - Trajectory conversion

## MDP Templates

Pre-configured templates available at `/data/.templates/`:
- `em.mdp` - Energy minimization
- `nvt.mdp` - NVT equilibration
- `npt.mdp` - NPT equilibration
- `md.mdp` - Production MD

Access templates via API:

```bash
curl "http://localhost:8000/templates/list"
curl "http://localhost:8000/templates/em.mdp"
```

## Environment Variables

- `WORK_DIR` - Working directory (default: `/data`)
- `MAX_UPLOAD_SIZE` - Max file upload size in bytes (default: `104857600`)
- `JOB_TIMEOUT` - Job timeout in seconds (default: `3600`)

## API Endpoints

### Files
- `POST /files/upload` - Upload file
- `GET /files/list` - List files
- `GET /files/download/{path}` - Download file
- `GET /files/view/{path}` - View file content
- `DELETE /files/delete/{path}` - Delete file

### GROMACS
- `POST /gromacs/execute` - Execute command (async)
- `POST /gromacs/execute/sync` - Execute command (sync)
- `GET /gromacs/version` - Get version
- `GET /gromacs/commands` - List commands
- `GET /gromacs/help/{command}` - Get help

### Jobs
- `GET /jobs` - List jobs
- `GET /jobs/{job_id}` - Get job details
- `DELETE /jobs/{job_id}` - Delete job
- `POST /jobs/{job_id}/cancel` - Cancel job
- `GET /jobs/{job_id}/logs` - Get logs

### System
- `GET /health` - Health check
- `GET /info` - System info
- `GET /metrics` - Resource metrics

## Development

### Local Development

```bash
# Install dependencies
pip install -r requirements.txt

# Run locally (requires GROMACS installed)
python app.py
```

### Build Custom Image

```bash
docker build -t my-gromacs-api .
docker run -d -p 8000:8000 -v ./data:/data my-gromacs-api
```

## License

MIT

## Support

For issues and questions, please open an issue on GitHub.
