# Phase 06 Package Management Verification

**Scope:** PKG-02 and PKG-03 package-management verification for the Bun-default
install/dev/build/start script contract, retained npm/Node fallback aliases, dual-lockfile
maintenance, and Bun-invoked Vite build static serving.

## Methodology

- Verified from the repository root on 2026-06-05.
- Used root scripts only for the documented build paths.
- Kept Vite retained as the client bundler; no Bun-native bundler replacement was introduced.
- Used the existing Phase 5 smoke harness:
  `server/test/runtime-smoke.test.mjs --assert-static`.
- Did not change Docker, CI, `check`, or test script migration scope.

## Lockfile Inventory

Both lockfile families are retained for all package-management roots:

| Root | Bun lockfile | npm fallback lockfile |
|------|--------------|-----------------------|
| repository root | `bun.lock` | `package-lock.json` |
| `client/` | `client/bun.lock` | `client/package-lock.json` |
| `server/` | `server/bun.lock` | `server/package-lock.json` |

Maintenance rule: when dependencies change, run `bun run lockfiles:refresh` and commit
both Bun and npm lockfile families together.

## Script Contract

| Workflow | Bun default | npm/Node fallback |
|----------|-------------|-------------------|
| install all roots | `bun run install:all` | `npm run install:all:node` |
| development | `bun run dev` | `npm run dev:node` |
| build | `bun run build` | `npm run build:node` |
| unified start | `bun run start` | `npm run start:node` |

The build default resolves through root `package.json` to `bun --cwd=client run build`.
The client package script remains `vite build`, so PKG-03 verifies a Bun package-runner
build with Vite retained.

## PKG-03 Vite Build

Command run:

```bash
bun run build
```

Result: passed. The command invoked `bun --cwd=client run build`, then `vite build`,
and produced `client/dist/index.html` plus built asset files under `client/dist/assets`.

Important assertion: Vite retained; Bun did not replace the frontend bundler.

## Static Serving Smoke

Command run:

```bash
FRONTEND_DIST=../client/dist SERVER_RUNTIME=bun bun --cwd=server run test:runtime-smoke -- --assert-static
```

Result: passed on retry with 15/15 smoke checks. The first attempt failed before server
startup because the ephemeral `mongodb-memory-server` process exceeded its 10s startup
timeout; no code or harness changes were made.

Static assertions recorded by the existing smoke harness:

- `GET / returns 200`
- `GET / returns HTML`

The same smoke also rechecked signin/JWT, health endpoints, Stripe webhook signature
handling, billing event fulfillment, and simulation token consumption while the server ran
under Bun with `FRONTEND_DIST=../client/dist`.

## npm/Node Fallback Build

Command run:

```bash
npm run build:node
```

Result: passed. The fallback invoked `npm --prefix client run build`, then `vite build`,
and regenerated `client/dist` successfully.

## Result

PKG-03 is verified: `bun run build` runs the retained Vite production build and the Bun
unified server serves that built frontend through the existing `--assert-static` smoke path.

PKG-02 remains usable through the documented script contract: Bun defaults are first-class
for install, dev, build, and start, while npm/Node fallback aliases remain executable for
rollback.
