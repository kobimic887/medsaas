# Combined repository map

Host / leftover copies (84, 151, 83, laptop): [`docs/WHERE.md`](./docs/WHERE.md).

This monorepo unifies the following GitHub projects into one runnable platform.

| Path | Upstream | Role |
|------|----------|------|
| `client/` + `server/` | [kobimic887/medsaas](https://github.com/kobimic887/medsaas) | Main Pyxis Discovery web app and API |
| `services/admet/` | [kobimic887/admet](https://github.com/kobimic887/admet) | RabbitMQ worker: ADMET-AI predictions → API callback |
| `services/gromacs-api/` | [kobimic887/gromacs-api](https://github.com/kobimic887/gromacs-api) | GROMACS + REST API (MD workflows) |
| `services/glioblastoma-predictor/` | [kobimic887/glioblastoma-predictor](https://github.com/kobimic887/glioblastoma-predictor) | Glioblastoma drug sensitivity API |
| `services/mcp-server/` | (in-repo) | MCP server exposing the platform's tools to Claude for Science / Life Sciences |
| External reference only (rollback FE) | [eitangenis/material-tailwind-dashboard-react](https://github.com/eitangenis/material-tailwind-dashboard-react) | Legacy Vite `:5173` tree on `84` — **rollback only**, not the public site |
| External reference only (rollback API) | [eitangenis/chem_beo](https://github.com/eitangenis/chem_beo) | Legacy API `:3000` on `84` — **rollback only** |
| External reference only | [eitangenis/eShop](https://github.com/eitangenis/eShop) | Legacy ASINEX stock storefront and `/api/Shop` contract reference; see [docs/ASINEX-ESHOP-HANDOFF.md](./docs/ASINEX-ESHOP-HANDOFF.md) |

## Duplicates resolved

- **chem_beo (two remotes):** Both forks are the same API lineage. Active development lives in
  `server/`; the old local archive was removed from this monorepo after the migration. The
  **public** site is this repo (`pyxis-web` on `:5174`). `eitangenis/chem_beo` remains the
  rollback API on `:3000` — not a second copy inside this repo.
- **Dashboard template:** Not a second frontend *in this monorepo*. `client/` is the only
  dashboard source here and is what `app.pyxis-discovery.com` serves. The Creative Tim Vite
  tree is rollback-only on `:5173`.
- **ASINEX eShop:** Not part of this monorepo. It is a legacy contract and behavior reference for the external stock endpoint configured by `ASINEX_STOCK_API_URL`.

## Service ports (local Docker)

Live public on 84 is systemd `pyxis-web` **:5174** (Bun + `client/dist`), not this local table.

| Service | Port |
|---------|------|
| Pyxis Discovery API / unified app | 3000 |
| Vite client (local `bun run dev`, or rollback on 84) | 5173 |
| Live public (`pyxis-web` on 84) | 5174 |
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
