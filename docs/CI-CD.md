# CI/CD

## Source Of Truth

This repo has two repo-owned workflow files:

- `.github/workflows/ci.yml` is the required quality gate.
- `.github/workflows/deploy.yml` is the manual non-prod deploy.

GitHub also shows several dynamic workflows that are not YAML files in this repo:

- `CodeQL` and `Dependency Graph` come from GitHub security settings.
- `Claude`, `Copilot`, `OpenAI Codex`, and `Copilot cloud agent` come from enabled GitHub agent/integration settings.

Keep `CodeQL` and `Dependency Graph` enabled. They are background security scans, not deploy paths. The agent workflows are optional workspace integrations; disable them in GitHub repository settings if their Actions noise is not useful.

## Order Of Operations

1. Open or update a PR into `main`.
2. `CI` runs on the PR:
   - Bun path: `bun run ci`
   - Node fallback path: `npm run ci:node`
3. Merge to `main` after CI is green.
4. `CI` runs again on the `main` push.
5. Run `Build & Deploy (non-prod)` manually from the Actions tab when you want to ship the current `main`.
6. `deploy.yml` calls `ci.yml` again through `workflow_call`; deploy starts only after that gate passes.
7. Deploy sends a source archive to the box, validates `docker-compose.box.yml`, builds the Docker image on the box, starts the stack, and checks `/health`.

## Deployment Model

The active non-prod deploy does not use GitHub Packages or GHCR.

The app image is built on the target box from the root `Dockerfile` and is tagged locally as `medsaas:local` by `docker-compose.box.yml`. This avoids stale registry images and avoids cross-architecture/QEMU build issues for the Oracle Ampere arm64 host.

The old `ghcr.io/kobimic887/medsaas:latest` path is legacy. Do not use it for current deploys. If the project later needs registry-based deploys again, add a dedicated image publish workflow and switch the compose file intentionally in the same change.

## Required Deploy State

GitHub secrets:

- `DEPLOY_SSH_KEY`
- `DEPLOY_HOST`
- `DEPLOY_USER`

Files on the deploy host:

- `~/medsaas/.env`

The host `.env` must contain the runtime secrets and Mongo credentials. It is deliberately not copied from GitHub Actions and is never committed.

## Planned Change: Deploy Target Moves To x86_64

Everything above describes the **current** deploy target: the Oracle Cloud VPS at
`151.145.91.17`, an Ampere A1 `aarch64` host. "The box" in this document means that machine.

The backend is planned to move to a dedicated Threadripper GPU machine in Amsterdam
(`x86_64`, two RTX PRO 5000 Blackwell cards). That invalidates one of the stated reasons for
the current model: build-on-box exists partly to avoid cross-architecture/QEMU issues on
arm64, and on an amd64 target a runner-side build or a registry becomes viable again.

Do not pre-emptively change these workflows. The architecture switch and the CORS/frontend
split are still open; the ingress decision is settled — see
[ARRIVAL-RUNBOOK.md](./ARRIVAL-RUNBOOK.md) §6. Update this document in the same
change that actually switches the target, not before, so it never describes a deploy path
that does not exist.

