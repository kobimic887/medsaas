---
phase: 3
plan: 1
wave: 1
autonomous: true
files_modified:
  - .github/workflows/deploy.yml
task_count: 1
requirements:
  - DEPLOY-01
---

# Phase 3 — Plan 1: CI/CD Pipeline

## Objective

Create a GitHub Actions workflow to build and deploy the medsaas Docker image.
The workflow must be valid YAML, build from the project's Dockerfile/compose setup,
and survive the branding and login code changes made in Phases 1 and 2.

## Note

This work was executed iteratively directly on main before the GSD milestone
scaffold was in place (commits 7a566b0 through 04d2110). The PLAN.md and
SUMMARY.md are being created retroactively to close the phase tracking.

## Tasks

### Task 1: Create deploy workflow

Create `.github/workflows/deploy.yml` with a GitHub Actions workflow that:
- Triggers on workflow_dispatch (manual) and optionally on push to main
- Ships a source archive over SSH to the Oracle VPS
- Runs `docker compose up --build` natively on the arm64 box
- Cleans up old images after deploy
