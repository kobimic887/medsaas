# Repository map

The repository is named `medsaas`; the product is Pyxis Discovery.

| Path | Responsibility |
|---|---|
| `client/` | React/Vite application and scientific viewers |
| `server/` | Express API, authentication, application data, and scientific proxies |
| `services/admet/` | Queue worker for ADMET predictions |
| `services/gromacs-api/` | Molecular-dynamics API |
| `services/glioblastoma-predictor/` | Drug-sensitivity prediction service |
| `services/macrocycle-index/` | Read-only compound index and similarity service |
| `services/mcp-server/` | MCP adapter for platform API tools |
| `deploy/` | Deployment definitions and compute-service implementations |
| `scripts/` | Local checks, imports, and maintenance utilities |

The application database is MongoDB Atlas. Scientific services are independently
configured; their presence in this repository does not mean they are running.

Start with [README.md](README.md) for development and
[docs/README.md](docs/README.md) for feature contracts. Deployment identity and
private infrastructure records are covered by [OPERATIONS.md](docs/OPERATIONS.md).
