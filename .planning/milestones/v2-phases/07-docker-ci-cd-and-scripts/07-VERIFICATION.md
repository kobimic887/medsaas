---
phase: 07-docker-ci-cd-and-scripts
verified: 2026-06-05T00:00:00Z
status: passed
score: 8/8
overrides_applied: 0
human_verification: []
---

# Phase 7: Docker, CI/CD, and Scripts — Verification Report

**Phase Goal:** The production Docker image uses oven/bun on arm64, the GitHub Actions pipeline runs on Bun, and all check/test scripts execute under Bun — with a single-change rollback path documented.
**Verified:** 2026-06-05
**Status:** passed
**Re-verification:** Final item closed 2026-06-05 — user directly ran `ssh oracle 'docker inspect medsaas:local --format "{{json .Config.Cmd}}"'` → `["bun","index.js"]`, confirming the running container's Bun entrypoint by direct observation (previously confirmed-by-inference).

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | The root Dockerfile frontend stage builds the client with Bun | VERIFIED | `FROM oven/bun:1.3.14-slim AS frontend`, `RUN bun install --frozen-lockfile`, `RUN bun run build` all present in Dockerfile |
| 2 | The root Dockerfile api stage installs deps with Bun and runs the server with Bun | VERIFIED | `FROM oven/bun:1.3.14-slim AS api`, `RUN bun install --frozen-lockfile --production`, `CMD ["bun", "index.js"]` present |
| 3 | The frontend dist is copied into the api stage and served by the Bun server | VERIFIED | `COPY --from=frontend /app/client/dist ../client/dist` and `ENV FRONTEND_DIST=../client/dist` both present |
| 4 | A single-change rollback to the Node image is documented and discoverable | VERIFIED | ROLLBACK.md exists at repo root; contains `node:22-alpine`, `CMD ["node", "index.js"]`, `OPS-04`, `:node` aliases, and `check:node` — all grep-confirmed |
| 5 | `bun run check` runs the syntax/build gate under Bun and exits 0 | VERIFIED | Executed this session: `bun build server/index.js --target=bun --outfile=/dev/null && bun --cwd=client run build` — exit 0, 895 modules + Vite build succeeded |
| 6 | `bun run test:brand` runs the brand check under Bun and exits 0 | VERIFIED | Executed this session: `bun scripts/check-brand.mjs` — exit 0, "Brand check passed: no retired-brand references" |
| 7 | `bun run test:stripe` (server) runs the Stripe webhook test under Bun and exits 0 | VERIFIED | Executed this session: `SERVER_RUNTIME=bun bun test/stripe-webhook.test.mjs` — exit 0, 8 passed / 0 failed; spawns real server under Bun against in-memory MongoDB, exercises SubtleCrypto async path |
| 8 | Each migrated script has a `:node` fallback that runs under Node | VERIFIED | `check:node`, `test:brand:node` in package.json; `test:stripe:node` in server/package.json — all grep-confirmed; `node --check` syntax gate retained in `check:node` |
| 9 | The deploy pipeline builds and runs the app on Bun via the oven/bun Dockerfile on the arm64 box | VERIFIED (external) | GH Actions run 27009254406 confirmed SUCCESS (1m15s) via `gh run view 27009254406`; deploy.yml triggers `docker compose -f docker-compose.box.yml up -d --build` on the Oracle box, which builds from the oven/bun Dockerfile; live `curl http://151.145.91.17:3000/health` returned HTTP 200 this session |
| 10 | The oven/bun container CMD is `["bun","index.js"]` on the running production host | VERIFIED | Directly observed 2026-06-05: user ran `ssh oracle 'docker inspect medsaas:local --format "{{json .Config.Cmd}}"'` → output `["bun","index.js"]`. Corroborates the inference (Dockerfile at HEAD has `CMD ["bun","index.js"]`, CI run 27009254406 built from that HEAD, `/health` 200) |

**Score:** 10/10 truths verified

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `Dockerfile` | Two-stage oven/bun production image (frontend build + api runtime) | VERIFIED | Both stages `FROM oven/bun:1.3.14-slim`; `bun install --frozen-lockfile` in both; `CMD ["bun", "index.js"]`; no `node:22-alpine` remaining |
| `ROLLBACK.md` | Documented one-change Docker+script rollback to Node | VERIFIED | Contains `node:22-alpine`, `OPS-04`, `:node` aliases, `check:node`, `CMD ["node", "index.js"]` |
| `package.json` | Bun-default check + test:brand scripts with :node fallbacks | VERIFIED | `check`, `check:bun`, `check:node`, `test:brand`, `test:brand:bun`, `test:brand:node` all present with correct commands |
| `server/package.json` | Bun-runnable test:stripe with :node fallback | VERIFIED | `test:stripe`: `SERVER_RUNTIME=bun bun test/stripe-webhook.test.mjs`; `test:stripe:node`: `node test/stripe-webhook.test.mjs` |
| `server/test/stripe-webhook.test.mjs` | Async Stripe test-header signing (Bun SubtleCrypto-compatible) | VERIFIED | Line 64 uses `await stripe.webhooks.generateTestHeaderStringAsync({ payload, secret })`; zero remaining synchronous `generateTestHeaderString(` calls; executed successfully under Bun this session (8 passed) |
| `.github/workflows/deploy.yml` | Bun-via-Dockerfile deploy pipeline to arm64 VPS (verified/annotated) | VERIFIED | Annotated with oven/bun comment; `docker compose -f docker-compose.box.yml up -d --build` present; `workflow_dispatch` only; push trigger commented; no redundant `setup-bun`/install steps |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| Dockerfile api stage | frontend stage dist | `COPY --from=frontend` | VERIFIED | `COPY --from=frontend /app/client/dist ../client/dist` present on line 13 |
| Dockerfile | Bun runtime | `CMD ["bun"` | VERIFIED | `CMD ["bun", "index.js"]` on line 18 |
| server/test/stripe-webhook.test.mjs | Stripe SDK async crypto | `await generateTestHeaderStringAsync` | VERIFIED | Line 64 confirmed; no sync variant remaining |
| .github/workflows/deploy.yml | root Dockerfile (oven/bun) | `docker-compose.box.yml up -d --build` | VERIFIED | Line 49; builds from `./src` context which is the git-archived repo root Dockerfile |

---

### Data-Flow Trace (Level 4)

Not applicable — this phase delivers infrastructure artifacts (Dockerfile, CI pipeline, test/check scripts), not dynamic data-rendering components.

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| `bun run check` exits 0 | `bun run check` (from repo root) | Exit 0; 895 modules bundled; Vite build succeeded | PASS |
| `bun run test:brand` exits 0 | `bun run test:brand` (from repo root) | Exit 0; "Brand check passed" | PASS |
| `bun run test:stripe` exits 0 | `cd server && bun run test:stripe` | Exit 0; 8 passed / 0 failed; Bun server spawned | PASS |
| Oracle VPS health check | `curl http://151.145.91.17:3000/health` | HTTP 200 | PASS |
| GH Actions deploy run 27009254406 | `gh run view 27009254406` | conclusion=success, 1m15s, all steps passed | PASS |

---

### Probe Execution

No conventional `scripts/*/tests/probe-*.sh` probes exist. Phase plans did not declare probe paths. Spot-checks above cover the locally-runnable behavioral verification.

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| OPS-01 | 07-01, 07-03 | Server Dockerfile uses oven/bun arm64 base image and builds successfully | SATISFIED | Dockerfile: 2x `FROM oven/bun:1.3.14-slim`, `CMD ["bun", "index.js"]`, no node:22-alpine; CI run 27009254406 built successfully on arm64 VPS |
| OPS-02 | 07-03 | GitHub Actions deploy pipeline uses Bun for install/build and deploys to Oracle arm64 VPS | SATISFIED | deploy.yml triggers on-box `docker compose up --build` from oven/bun Dockerfile; GH run 27009254406 succeeded; `/health` 200 confirmed |
| OPS-03 | 07-02 | check, test:brand, and test:stripe scripts run under Bun | SATISFIED | All three scripts executed this session: `bun run check` (exit 0), `bun run test:brand` (exit 0), `cd server && bun run test:stripe` (exit 0, 8/0) |
| OPS-04 | 07-01 | Documented rollback path reverts to Node image/scripts with a single change | SATISFIED | ROLLBACK.md at repo root; documents one-file Dockerfile revert; all `:node` script fallbacks listed; OPS-04 traceable |

**Note on REQUIREMENTS.md tracking:** OPS-03 is still marked `[ ]` (Pending) and `| OPS-03 | Phase 7 | Pending |` in `.planning/REQUIREMENTS.md`. The implementation is complete and confirmed by direct execution. This is a stale tracking checkbox — the document was not updated after OPS-03 was implemented. **This does not affect goal status** (the codebase is the source of truth), but the human should update the REQUIREMENTS.md checkbox to `[x]` and the traceability row to "Complete".

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `.github/workflows/deploy.yml` | 1 (annotation) | `actions/checkout@v4` uses Node.js 20 which is deprecated (GitHub warns: forced removal from runners September 16, 2026) | WARNING | The CI pipeline may break on Node.js 24 rollout in June 2026 unless `actions/checkout` is updated to a Node.js 24-compatible version. Not a Phase 7 deliverable issue — this is an upstream runner change. No TBD/FIXME/XXX markers. |

No TBD, FIXME, or XXX debt markers found in any Phase 7 modified file (Dockerfile, ROLLBACK.md, package.json, server/package.json, server/test/stripe-webhook.test.mjs, .github/workflows/deploy.yml).

---

### Human Verification Required

None outstanding. The single prior item — confirming the running container CMD on the Oracle VPS — was directly observed on 2026-06-05: `ssh oracle 'docker inspect medsaas:local --format "{{json .Config.Cmd}}"'` returned `["bun","index.js"]`.

---

### Gaps Summary

No gaps. All 10 must-have truths are VERIFIED, including the formerly inference-only container CMD check (now directly observed). Phase 7 goal is fully achieved.

**Informational items (not gaps):**
1. ~~REQUIREMENTS.md OPS-03 checkbox stale~~ — RESOLVED 2026-06-05 (commit `913008c`): OPS-03 marked `[x]` / "Complete".
2. `actions/checkout@v4` uses Node.js 20 which GitHub warns will be forced to Node.js 24 by June 2026. Not a Phase 7 deliverable issue, but the workflow will need updating before the runtime deadline.

---

_Verified: 2026-06-05_
_Verifier: Claude (gsd-verifier)_
