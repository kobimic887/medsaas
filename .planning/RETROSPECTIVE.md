# Project Retrospective

*A living document updated after each milestone. Lessons feed forward into future planning.*

## Milestone: v2 — Bun Migration

**Shipped:** 2026-06-05
**Phases:** 4 (Phases 4–7) | **Plans:** 12 | **Tasks:** 24

### What Was Built
- Express API running on the Bun runtime in dev + prod, with the RAM hypothesis empirically validated (Bun idle RSS 115.1 MiB < 118.9 MiB Node baseline — MEAS-03 gate PASS).
- Package management on `bun install` with committed `bun.lock` (root/client/server) and Bun-default scripts, Vite retained as the bundler (invoked through Bun).
- Production `oven/bun:1.3.14-slim` arm64 Docker image, deployed on the box via the CI pipeline and serving `/health` 200 on the Oracle VPS.
- A one-change Node rollback at every layer (`:node` script aliases + a single-edit `Dockerfile` revert documented in ROLLBACK.md).

### What Worked
- **Spike-before-commit.** Phase 4 proved arm64 dep compatibility (Mongo, amqplib, Stripe, RDKit-WASM, `oven/bun`) and captured Node baselines *before* any production change — the migration never proceeded on assumption.
- **Measurement-gated outcomes.** "Bun becomes default" was conditioned on a real before/after RSS measurement, not a vibe. The gate (MEAS-03) made "done" observable.
- **Empirical planning.** The Phase 7 planner *ran* the Stripe test during planning and discovered it was actually broken under Bun (sync SubtleCrypto), not merely unmigrated — so the plan shipped a real fix with verified acceptance commands instead of a guess.
- **Honest infra verification.** OPS-01/OPS-02 (VPS deploy) were split into locally-checkable source edits (`autonomous: true`) and a real on-box checkpoint (`autonomous: false`), avoiding false-positive "healthy" claims. The container CMD was confirmed by direct `docker inspect` only after the user ran it.

### What Was Inefficient
- **Stale memory cost an early wrong assumption.** The MEMORY.md index hook said "GHCR-pull CI/CD, Atlas DB"; the live repo actually builds on the box (git-archive → `docker compose --build`, local mongo). Caught by verifying against the repo, but it briefly mislead. Fixed the index hook this session.
- **Milestone accomplishment auto-extraction emitted noise** (`one_liner:` / `Task 1 (completed prior):`) because a few SUMMARY.md `one_liner` fields weren't in the expected shape — required a manual cleanup pass on MILESTONES.md.
- **Sandbox gating surfaced late.** The VPS `ssh`/deploy gate fired mid-execution rather than being anticipated, briefly stalling the OPS-02 checkpoint until the push+CI path was authorized.

### Patterns Established
- **Bun forces async Web Crypto.** Bun's SubtleCrypto is async-only: `stripe.webhooks.constructEvent` → `constructEventAsync` (Phase 5) and `generateTestHeaderString` → `generateTestHeaderStringAsync` (Phase 7). Any sync crypto call is a Bun landmine.
- **`bun build --target=bun --outfile=/dev/null` substitutes for `node --check`** — Bun has no syntax-only flag; bundling resolves the full module graph. Keep `node --check` under a `:node` alias.
- **Dual lockfiles** (`bun.lock` + `package-lock.json`) keep Bun default + npm fallback both reproducible; refresh via `bun run lockfiles:refresh`.
- **`:node` fallback per migrated capability** — a consistent, low-cost rollback convention across runtime, scripts, and Docker.

### Key Lessons
1. Gate runtime swaps on a measured metric, not an expectation — the RAM win was a hypothesis until Phase 5 proved it.
2. For infra/deploy phases, never assert remote health from a local environment; mark on-box steps `autonomous: false` and verify against the real host.
3. Verify "facts" from memory against the live repo before acting — a one-line stale index hook can misdirect an entire approach.
4. Let the planner execute the risky commands during planning; catching a real bug (broken Stripe test under Bun) at plan time is far cheaper than at execute time.

### Cost Observations
- Model mix: orchestration on Opus, executors/verifier on Sonnet (roughly opus-driven coordination + sonnet plan execution; no haiku).
- Notable: sequential on-`main` execution (no worktrees) was the right call for tiny, non-overlapping, pre-verified plans — the worktree merge-back machinery would have been pure failure surface.

---

## Cross-Milestone Trends

### Process Evolution

| Milestone | Phases | Plans | Key Change |
|-----------|--------|-------|------------|
| v1 — ChemBench Cleanup | 3 | 3 | Established native arm64 on-box deploy pipeline (no QEMU/registry) |
| v2 — Bun Migration | 4 | 12 | Spike-before-commit + measurement-gated runtime swap; `:node` fallback discipline |

### Cumulative Quality

| Milestone | Requirements | Zero-Dep Additions |
|-----------|-------------|-------------------|
| v1 | 10/10 | brand-check guard (no new runtime deps) |
| v2 | 20/20 | 1 (`concurrently` for root script orchestration); runtime/package/Docker swaps added no app deps |

### Top Lessons (Verified Across Milestones)

1. Prove the risky constraint empirically before committing the roadmap (v1 arm64 deploy; v2 Bun arm64 compat).
2. Keep a single-change rollback for anything that touches the deploy/runtime path.
