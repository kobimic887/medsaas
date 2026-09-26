# Pyxis Discovery

Pyxis Discovery is a molecular research platform for compound search, docking,
protein folding, molecule generation, and molecular visualization. This repository
contains the web app, API, and supporting scientific services.

## Get started

Use Bun (the version used in CI is pinned in
[ci.yml](.github/workflows/ci.yml)) and Node.js 24 for scripts that invoke Node.

```bash
bun run install:all
```

Configure the API with the project maintainer before starting it. The normal app
requires these environment variables:

| Variable | Purpose |
| --- | --- |
| `MONGODB_URI` | Approved MongoDB Atlas database connection |
| `JWT_SECRET` | Session signing secret, at least 32 characters |
| `STRIPE_SECRET_KEY` | Stripe key for the intended environment; use test mode for development |
| `FRONTEND_URL` | `http://localhost:5173` for local email links |

The server accepts environment variables or a private root `.env`. Keep credentials
out of Git. Confirm the target database: signup, history, orders, and credit changes
write to it. The legacy local-Mongo defaults in `.env.example` and `services:up`
are not the supported project setup.

Start the API and frontend:

```bash
bun run dev:bun
```

Open **http://localhost:5173**. Vite forwards API requests to port 3000. Use
`dev:bun` because the older `dev` bootstrap can create an environment file and
attempt to start local MongoDB.

For frontend-only work, `bun --cwd=client run dev` starts Vite; authenticated
features still need a configured API. Email and scientific features require their
respective providers. See the [service map](REPOS.md) for individual setup guides.

## Everyday commands

| Command | Purpose |
| --- | --- |
| `bun run check` | Compile the API and build the frontend |
| `bun run lint` | Check source lint rules |
| `bun run test` | Run the server test suite |
| `bun run ci` | Run the full Bun validation suite |
| `bun run start` | Build the frontend and serve it through the API |

Choose the nearest existing test for the change; a documentation edit does not
need a full application build. [CI and verification](docs/CI-CD.md) explains what
runs automatically and how to run focused checks. Some server tests download an
isolated MongoDB test binary; they do not require a running application database.

Root, `client/`, and `server/` retain Bun and npm lockfiles. After dependency
changes, run `bun run lockfiles:refresh` and commit both lockfile families.
Node fallback commands remain available in [package.json](package.json).

## Repository layout

| Directory | Contents |
| --- | --- |
| [`client/`](client/) | React + Vite dashboard and molecular viewers |
| [`server/`](server/) | Express API, authentication, billing, and scientific proxies |
| [`services/`](services/) | Scientific workers, search indexes, and MCP integration |
| [`deploy/`](deploy/) | Service templates and compute packaging |
| [`scripts/`](scripts/) | Verification and data maintenance tools |
| [`docs/`](docs/README.md) | Feature contracts and development references |

## Further reading

- [Documentation index](docs/README.md)
- [Product direction](GOAL.md)
- [Staging behavior](docs/STAGING.md) — staging can use real production data and credits
- [Contributor and agent conventions](AGENTS.md)
- [Operations](docs/OPERATIONS.md) — deployment is manual; pushing code does not deploy
