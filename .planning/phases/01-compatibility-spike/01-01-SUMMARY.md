---
phase: 01-compatibility-spike
plan: 01
subsystem: infra
tags: [node-vibrant, sharp, bun, docker, arm64, libvips, palette-extraction, spike]

# Dependency graph
requires:
  - phase: v2 (Bun Migration, Phase 4-7)
    provides: spike/ harness pattern + pinned oven/bun:1.3.14-slim arm64 production image
provides:
  - "GO verdict: node-vibrant@4 + sharp@0.34 install + extract a structured palette under Bun on linux/arm64 in oven/bun:1.3.14-slim"
  - "node-vibrant v4 import shape resolved: import { Vibrant } from 'node-vibrant/node' (root export throws); Vibrant.from(src).getPalette()"
  - "node-vibrant node decoder is jimp (PNG/JPEG, no SVG); SVG path works via sharp rasterization (libvips rsvg 2.61.2 present in the slim arm64 image)"
  - "Throwaway spike: spike/06-vibrant.ts, spike/Dockerfile.vibrant, spike/run-vibrant-check.sh, spike/vibrant-package.json, spike/fixtures/logo.svg"
affects: [Phase 2 Branding Management, palette extraction, logo upload, sharp, node-vibrant]

# Tech tracking
tech-stack:
  added: [node-vibrant@4.0.4 (spike only), sharp@0.34.5 (spike only)]
  patterns: [spike-before-commit, container arm64 assertion via docker image inspect, sharp-synthesized raster fixture]

key-files:
  created:
    - spike/06-vibrant.ts
    - spike/Dockerfile.vibrant
    - spike/run-vibrant-check.sh
    - spike/vibrant-package.json
    - spike/fixtures/logo.svg
    - spike/VIBRANT-FINDINGS.md
  modified:
    - spike/README.md

key-decisions:
  - "GO — Phase 2 proceeds on node-vibrant@4 + sharp@0.34 (no fallback needed; D-08 contingency not triggered)"
  - "Use node-vibrant v4 via the node-vibrant/node subpath; the package root export intentionally throws in v4"
  - "Rasterize SVG with sharp before palette extraction — node-vibrant's jimp decoder cannot read SVG; libvips in the slim arm64 image includes librsvg so this works in-container"
  - "dominant/accent = two most-populous non-null swatches (names not hardcoded), since any of the 6 named swatches may be null"

patterns-established:
  - "Container spike verified on the oracle arm64 box (no local Docker): git archive HEAD spike | ssh oracle 'tar -x' then bash spike/run-vibrant-check.sh"
  - "Raster fixture synthesized at runtime by sharp (no binary blob committed) to keep fixture provenance off the repo"

requirements-completed: [COMPAT-01]

# Metrics
duration: ~20min
completed: 2026-06-06
---

# Phase 1 (Plan 01-01): Compatibility Spike Summary

**GO verdict — node-vibrant@4.0.4 + sharp@0.34.5 install with no native-binding errors and extract a structured palette `{ dominant: #f49c0c, accent: #1c3c8c }` under Bun on linux/arm64 in `oven/bun:1.3.14-slim`; SVG→palette also works in-container via sharp/libvips.**

## Performance

- **Duration:** ~20 min
- **Completed:** 2026-06-06
- **Tasks:** 3
- **Files modified:** 7 (6 created, 1 modified)
- **Run target:** `oracle` (Oracle Cloud Ampere, native arm64), Docker 29.2.1 — no local Docker on the dev Mac

## Accomplishments
- **COMPAT-01 proven GO** on a real arm64 host inside the production base image — Phase 2 can build on `node-vibrant` + `sharp` without re-deciding.
- **Resolved the one question delegated to absent research:** node-vibrant **v4** is current; its root export throws, so the Node build is imported via `node-vibrant/node` and used as `Vibrant.from(src).getPalette()`.
- **Mapped the SVG path for Phase 2:** node-vibrant's decoder is jimp (no SVG); `sharp` (libvips `rsvg 2.61.2`, confirmed in-image) rasterizes SVG → palette, so no external pre-rasterization service is needed.
- `bun install` of both libs completed cleanly (sharp pulled its prebuilt linux-arm64 glibc binary — the specific native-binding risk — with no error).

## Task Commits

Each task was committed atomically:

1. **Task 1: Throwaway manifest + SVG fixture** — `a3e89ff` (feat)
2. **Task 2: Spike script + Dockerfile + container-run harness** — `9a956fb` (feat)
3. **Task 3: GO/NO-GO findings doc + README update** — `9263cf2` (docs)

## Files Created/Modified
- `spike/06-vibrant.ts` — synthesizes a raster via sharp, extracts a structured palette via node-vibrant/node, probes SVG via sharp rasterization
- `spike/Dockerfile.vibrant` — minimal `oven/bun:1.3.14-slim` image, `bun install`s node-vibrant + sharp, runs the spike
- `spike/run-vibrant-check.sh` — builds, asserts image arch arm64, runs the spike once
- `spike/vibrant-package.json` — throwaway manifest pinning node-vibrant@4.0.4 + sharp@0.34.5
- `spike/fixtures/logo.svg` — 3-colour SVG for the rasterization probe
- `spike/VIBRANT-FINDINGS.md` — GO verdict with full evidence
- `spike/README.md` — COMPAT-01 Scripts + Results rows

## Decisions Made
- **GO** against D-07 PASS criteria; D-08 NO-GO contingency recorded but not triggered.
- node-vibrant v4 import shape and jimp-vs-SVG facts captured for Phase 2 (see VIBRANT-FINDINGS.md).

## Deviations from Plan

**1. Container verification run on the remote arm64 box instead of locally**
- **Found during:** execution start (environment probe)
- **Issue:** The dev Mac has no container runtime (no docker/podman/colima). The plan's verify steps (`bash spike/run-vibrant-check.sh`) require Docker, and a host-only Bun run on macOS would not prove the linux/arm64-in-container target the spike exists for.
- **Fix:** User chose the Oracle arm64 VPS (the deploy target). Shipped the committed `spike/` tree via `git archive HEAD spike | ssh oracle 'tar -x'` (no rsync on the box) and ran `bash spike/run-vibrant-check.sh` there. The plan explicitly anticipated `ssh oracle` as a run target (line 153).
- **Verification:** Image arch reported `arm64`; spike exited 0 with the structured palette + SVG-probe-OK printed.
- **Impact:** None on artifacts — the committed spike files are unchanged; only the run host differed. Faithful to the v2 "Verified on oracle" precedent.

**2. Plan executed inline by the orchestrator (not a spawned worktree executor)**
- **Issue:** A worktree executor would hit the same no-local-Docker wall, and the remote `git archive`→`ssh`→build flow needed direct orchestration.
- **Fix:** Ran the plan inline (sequential), honoring the execute-plan contract (atomic per-task commits, SUMMARY.md, tracking updates).
- **Impact:** None — same commit discipline and artifacts.

## Issues Encountered
None. The library API/import shape was confirmed from npm + published types before the remote build, so the first container build passed.

## User Setup Required
None — no external service configuration. (Verification used the existing `ssh oracle` access.)

## Next Phase Readiness
- **Phase 2 (Branding Management) is unblocked.** Palette extraction stack proven: `node-vibrant@4` (via `node-vibrant/node`) + `sharp@0.34` on the production arm64 image.
- **For Phase 2 wiring:** import `{ Vibrant } from "node-vibrant/node"`; rasterize SVG uploads with sharp before extraction; treat the palette as up-to-6 nullable named swatches and pick dominant/accent by population.
- Spike code is throwaway/reference — safe to delete after Phase 2 once findings are migrated into production.

---
*Phase: 01-compatibility-spike*
*Completed: 2026-06-06*
