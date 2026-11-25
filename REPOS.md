# Repository map

The repository is named `medsaas`; the product is Pyxis Discovery.

| Path | Responsibility |
|---|---|
| `client/` | React/Vite application and scientific viewers |
| `server/` | Express API, authentication, application data, and scientific proxies |
| [`services/admet/`](services/admet/README.md) | Queue worker for ADMET predictions |
| [`services/catalog-sql/`](services/catalog-sql/README.md) | SQL schema for inspecting stock and macrocycle catalogs |
| [`services/glioblastoma-predictor/`](services/glioblastoma-predictor/README.md) | Drug-sensitivity prediction service |
| [`services/gromacs-api/`](services/gromacs-api/README.md) | Molecular-dynamics API |
| [`services/insights-agent/`](services/insights-agent/README.md) | PubMed-to-draft agent for the WordPress Insights blog |
| [`services/learning-center/`](services/learning-center/README.md) | WordPress plugin for the `/learning/` hub |
| [`services/link-fragments/`](services/link-fragments/README.md) | Two-fragment 3D linker matching and refinement |
| `services/macrocycle-index/` | Read-only compound index and similarity service (see [macrocycle data](docs/DATA-MACROCYCLES.md)) |
| [`services/mcp-server/`](services/mcp-server/README.md) | MCP adapter for platform API tools |
| `services/omniroute-staging-proxy/` | Bounded AI bridge used by staging (see its docstring in `server.py`) |
| [`services/owned-search/`](services/owned-search/README.md) | Identifier, exact, and substructure search over owned sources |
| [`services/stock-catalog/`](services/stock-catalog/README.md) | WordPress plugin for the public stock listing |
| `deploy/` | Deployment definitions and compute-service implementations: [`box/`](deploy/box/BRIEF-SERVICES.md), [`nginx/`](deploy/nginx/README.md), [`staging/`](deploy/staging/README.md), `stock-availability/`, [`83/`](deploy/83/systemd/README.md) (historical templates) |
| `scripts/` | Local checks, imports, and maintenance utilities |

The application database is MongoDB Atlas. Scientific services are independently
configured; their presence in this repository does not mean they are running.

Start with [README.md](README.md) for development and
[docs/README.md](docs/README.md) for feature contracts. Deployment identity and
private infrastructure records are covered by [OPERATIONS.md](docs/OPERATIONS.md).
