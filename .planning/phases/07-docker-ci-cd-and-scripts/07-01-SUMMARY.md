---
phase: 07-docker-ci-cd-and-scripts
plan: "01"
subsystem: docker
tags: [docker, bun, deployment, rollback, ops]
dependency_graph:
  requires: []
  provides: [bun-dockerfile, node-rollback-doc]
  affects: [deployment-pipeline, oracle-vps-build]
tech_stack:
  added: []
  patterns: [oven/bun:1.3.14-slim two-stage build, --frozen-lockfile reproducible install]
key_files:
  created: [ROLLBACK.md]
  modified: [Dockerfile]
decisions:
  - "Both Dockerfile stages pin to oven/bun:1.3.14-slim (proven arm64 tag from Phase 4 spike)"
  - "bun install --frozen-lockfile used in both stages — reproducible from committed bun.lock"
  - "ROLLBACK.md documents single-edit Dockerfile revert and already-shipped :node script fallbacks"
metrics:
  duration: "~3 min"
  completed: "2026-06-05"
  tasks: 2
  files: 2
---

# Phase 7 Plan 01: Dockerfile Bun Conversion Summary

**One-liner:** Two-stage Dockerfile converted to `oven/bun:1.3.14-slim` with `--frozen-lockfile` installs and a Node rollback doc (OPS-01, OPS-04).

## What Was Built

**Task 1 — Convert both Dockerfile stages to oven/bun (commit: d1ca318)**

Rewrote the root `Dockerfile` from `node:22-alpine` to `oven/bun:1.3.14-slim` in both stages:
- Frontend stage: `bun install --frozen-lockfile` + `bun run build` (Vite still the bundler)
- API stage: `bun install --frozen-lockfile --production` + `CMD ["bun", "index.js"]`
- Lockfile copy pattern updated: `COPY client/package.json client/bun.lock ./` (glob would miss bun.lock)
- Frontend dist copy (`COPY --from=frontend /app/client/dist ../client/dist`) and `ENV FRONTEND_DIST=../client/dist` preserved exactly — unified static serving intact

**Task 2 — Document single-change Node rollback (commit: 127b89b)**

Created `ROLLBACK.md` at repo root documenting:
- Docker rollback: swap both `FROM oven/bun:1.3.14-slim` → `FROM node:22-alpine` and `CMD ["bun"]` → `CMD ["node"]`, revert install commands. One file, one `git revert`.
- Script fallbacks: all `:node`-suffixed aliases already shipped (Phases 5–6), no new changes needed. Cross-references Plan 02 additions (`check:node`, `test:brand:node`, `test:stripe:node`).
- OPS-04 traceability inline.

## Verification

All acceptance criteria passed via grep (no Docker required per plan — container health is Plan 03's autonomous:false on-box verification):

```
grep -c '^FROM oven/bun:1.3.14-slim' Dockerfile  → 2
grep -c 'FROM .*node:22-alpine' Dockerfile         → 0
CMD ["bun", "index.js"] present                    → OK
COPY --from=frontend ... present                   → OK
bun install --frozen-lockfile count               → 2
No oven/bun:latest                                 → OK
ENV FRONTEND_DIST=../client/dist                   → OK
ROLLBACK.md: node:22-alpine, OPS-04, :node, check:node → all OK
```

## Deviations from Plan

None — plan executed exactly as written.

## Threat Model Compliance

- **T-07-01 (Tampering / base image tag):** Mitigated — `oven/bun:1.3.14-slim` pinned exactly, no `latest` tag.
- **T-07-02 (Tampering / dependency resolution):** Mitigated — `--frozen-lockfile` in both stages; installs only what committed `bun.lock` pins.
- **T-07-03 (Info Disclosure / secrets in layers):** Accepted — no `.env` copy, no ENV secrets; runtime secrets injected by `docker-compose.box.yml` via `env_file`.
- **T-07-SC (Package legitimacy):** N/A — no new packages added.

## Known Stubs

None.

## Threat Flags

None — no new network endpoints, auth paths, or trust-boundary schema changes introduced.
