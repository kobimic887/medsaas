# Pyxis Discovery

Pyxis Discovery is a molecular research platform for compound search, docking,
protein folding, molecule generation, and molecular visualization. This repository
contains the web app, API, and supporting scientific services.

## Set up a new machine

Install Git, [Bun](https://bun.sh) and Node.js 24. CI pins Bun in
[ci.yml](.github/workflows/ci.yml); match that version if a check behaves
differently on your machine. Node is only needed for the `:node` fallback commands
and a few scripts. Server-boot tests look for Bun at `~/.bun/bin/bun` (the
installer's default) unless `BUN_PATH` points elsewhere.

```bash
git clone https://github.com/kobimic887/medsaas.git
cd medsaas
bun run install:all
```

### What works without credentials

These need no database, payment, or provider access, so run them first to confirm
the machine is set up:

```bash
bun run check        # compile the API and build the frontend
bun run lint
bun run test:brand
bun --cwd=client run dev   # frontend only, at http://localhost:5173
```

Most server tests also run without credentials; they use an isolated MongoDB test
process (see [CI and verification](docs/CI-CD.md)). The frontend alone cannot sign
in or load data, because the API is not running.

### Running the full app

The API refuses to start without these environment variables:

| Variable | Purpose |
| --- | --- |
| `MONGODB_URI` | Approved MongoDB Atlas database connection |
| `JWT_SECRET` | Session signing secret, at least 32 characters |
| `STRIPE_SECRET_KEY` | Stripe key for the intended environment; use test mode for development |
| `FRONTEND_URL` | `http://localhost:5173` for local email links |

This repository does not provide these values or point to a secret store. Ask the
project maintainer for them, and for the Atlas database you should use. Put them
in the environment or in a private root `.env`, which Git ignores; never commit
them. `.env.example` lists the variable names, but its local-Mongo defaults and
`services:up` are legacy, not the supported setup.

Starting the API connects to the configured database straight away, and signup,
history, orders, and credit changes write to it. Confirm the target before you
start:

```bash
bun run dev:bun
```

Open **http://localhost:5173**. Vite forwards API requests to port 3000. Prefer
`dev:bun`: `dev` runs the same processes after an informational `predev` message,
and neither creates configuration files or starts MongoDB.

Email and scientific features also need their own providers. See the
[repository map](REPOS.md) for each service's setup guide.

## Everyday commands

| Command | Purpose |
| --- | --- |
| `bun run check` | Compile the API and build the frontend |
| `bun run lint` | Check source lint rules |
| `bun run test` | Run the server test suite |
| `bun run ci` | Run the full Bun validation suite |
| `bun run start` | Build the frontend and serve it through the API |
| `bun run test:*` | Focused checks; the [CI guide](docs/CI-CD.md) maps changes to checks |

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
