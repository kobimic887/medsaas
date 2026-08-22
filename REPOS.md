# Combined repository map

This monorepo unifies the following GitHub projects into one runnable platform.

| Path | Upstream | Role |
|------|----------|------|
| `client/` + `server/` | [kobimic887/medsaas](https://github.com/kobimic887/medsaas) | Main Pyxis Discovery web app and API |
| `services/admet/` | [kobimic887/admet](https://github.com/kobimic887/admet) | RabbitMQ worker: ADMET-AI predictions → API callback |
| `services/gromacs-api/` | [kobimic887/gromacs-api](https://github.com/kobimic887/gromacs-api) | GROMACS + REST API (MD workflows) |
| `services/glioblastoma-predictor/` | [kobimic887/glioblastoma-predictor](https://github.com/kobimic887/glioblastoma-predictor) | Glioblastoma drug sensitivity API |
| `services/mcp-server/` | (in-repo) | MCP server exposing the platform's tools to Claude for Science / Life Sciences |
| External reference only (live legacy FE) | [eitangenis/material-tailwind-dashboard-react](https://github.com/eitangenis/material-tailwind-dashboard-react) | What `app.pyxis-discovery.com` still serves via Vite `:5173` until the port swap |
| External reference only (live legacy API) | [eitangenis/chem_beo](https://github.com/eitangenis/chem_beo) | What Vite proxies to on `:3000` until the port swap |
| External reference only | [eitangenis/eShop](https://github.com/eitangenis/eShop) | Legacy ASINEX stock storefront and `/api/Shop` contract reference; see [docs/ASINEX-ESHOP-HANDOFF.md](./docs/ASINEX-ESHOP-HANDOFF.md) |

## Duplicates resolved

- **chem_beo (two remotes):** Both forks are the same API lineage. Active development lives in
  `server/`; the old local archive was removed from this monorepo after the migration. The
  **live** public site still runs a deploy of `eitangenis/chem_beo` on the application host
  until Release A / the port swap — that is intentional, not a second copy inside this repo.
- **Dashboard template:** Not a second frontend *in this monorepo*. `client/` is the only
  dashboard source here. The **live** public site still runs
  `eitangenis/material-tailwind-dashboard-react` via Vite until the same port swap.
- **ASINEX eShop:** Not part of this monorepo. It is a legacy contract and behavior reference for the external stock endpoint configured by `ASINEX_STOCK_API_URL`.

## Service ports (local Docker)

| Service | Port |
|---------|------|
| Pyxis Discovery API / unified app | 3000 |
| Vite dev client | 5173 |
| MongoDB | 27017 |
| RabbitMQ | 5672 (AMQP), 15672 (UI) |
| GROMACS API | 8001 → container 8000 |
| Glioblastoma predictor | 5000 |
| MCP server (published as chembench-mcp) | 8080 |

## Syncing upstream changes

To pull updates from an upstream repo into a service folder:

```bash
git remote add admet-upstream https://github.com/kobimic887/admet.git
git fetch admet-upstream
git subtree pull --prefix=services/admet admet-upstream main
```

Repeat with the appropriate remote and prefix per service.
