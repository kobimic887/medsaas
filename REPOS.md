# Combined repository map

This monorepo unifies the following GitHub projects into one runnable platform.

| Path | Upstream | Role |
|------|----------|------|
| `client/` + `server/` | [kobimic887/medsaas](https://github.com/kobimic887/medsaas) | Main Pyxis-Discovery web app and API |
| `services/admet/` | [kobimic887/admet](https://github.com/kobimic887/admet) | RabbitMQ worker: ADMET-AI predictions → API callback |
| `services/gromacs-api/` | [kobimic887/gromacs-api](https://github.com/kobimic887/gromacs-api) | GROMACS + REST API (MD workflows) |
| `services/glioblastoma-predictor/` | [kobimic887/glioblastoma-predictor](https://github.com/kobimic887/glioblastoma-predictor) | Glioblastoma drug sensitivity API |
| `packages/dashboard-template/` | [eitangenis/material-tailwind-dashboard-react](https://github.com/eitangenis/material-tailwind-dashboard-react) | UI reference; client already uses Material Tailwind |
| `legacy/chem-beo-api/` | [eitangenis/chem_beo](https://github.com/eitangenis/chem_beo), [kobimic887/chem_beo](https://github.com/kobimic887/chem_beo) | Superseded standalone API (kept for diff/scripts) |

## Duplicates resolved

- **chem_beo (two remotes):** Both forks are the same API lineage. Active development lives in `server/`; `legacy/chem-beo-api/` is archival.
- **Dashboard template:** Not a second frontend—`packages/dashboard-template/` is the upstream Material Tailwind dashboard for component reference.

## Service ports (local Docker)

| Service | Port |
|---------|------|
| MedSaaS API / unified app | 3000 |
| Vite dev client | 5173 |
| MongoDB | 27017 |
| RabbitMQ | 5672 (AMQP), 15672 (UI) |
| GROMACS API | 8001 → container 8000 |
| Glioblastoma predictor | 5000 |

## Syncing upstream changes

To pull updates from an upstream repo into a service folder:

```bash
git remote add admet-upstream https://github.com/kobimic887/admet.git
git fetch admet-upstream
git subtree pull --prefix=services/admet admet-upstream main
```

Repeat with the appropriate remote and prefix per service.
