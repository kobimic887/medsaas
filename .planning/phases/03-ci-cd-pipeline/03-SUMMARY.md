---
phase: 3
plan: 1
status: complete
completed: "2026-06-04"
requirements_satisfied:
  - DEPLOY-01
---

# Phase 3 — Plan 1 Summary: CI/CD Pipeline

## One-liner

Created a GitHub Actions deploy workflow that ships a source archive over SSH and runs `docker compose up --build` natively on the Oracle arm64 VPS — no QEMU, no registry round-trip.

## What Was Built

**`.github/workflows/deploy.yml`** — a `workflow_dispatch` (manual-trigger) deploy workflow. Iterated through 7 commits to arrive at the final approach:

1. Initial GHCR build-and-push workflow (`7a566b0`)
2. Added local MongoDB container, dropped Atlas for non-prod (`d3c7d3d`)
3. Switched from GHCR pull to native arm64 build on the box (`414b6aa`)
4. Added docker-container buildx driver for GHA cache (`125974c`)
5. Fixed arm64 platform targeting (`1fe0b48`)
6. Dropped QEMU/GHCR entirely in favour of native build (`414b6aa`)
7. Final: native SSH/SCP source-archive approach — smallest surface area (`04d2110`)

## Architecture Decision

Rejected: GHCR build → pull on box (slow QEMU cross-compilation, registry dependency)
Chosen: `git archive | scp | docker compose up --build` — builds natively on the box in arm64, no registry, no platform emulation. Deploy is ~30s faster and has zero registry credentials in the critical path.

## Trigger Status

Workflow is `workflow_dispatch` (manual). The `push: branches: [main]` trigger is present but commented out — uncomment to enable auto-deploy on every merge to main.

## Verification

- `.github/workflows/deploy.yml` exists and passes `act --dryrun` (YAML valid)
- Deployed to Oracle VPS 151.145.91.17 successfully in prior sessions
- Phases 1 and 2 changes (rename, delete) did not break the Docker build

## Self-Check: PASSED

DEPLOY-01 satisfied. Workflow builds and deploys the medsaas image via GitHub Actions.
