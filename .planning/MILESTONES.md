# Milestones

## v2 — Bun Migration

**Shipped:** 2026-06-05
**Phases:** 4 (Phases 4–7) | **Plans:** 12 | **Tasks:** 24
**Requirements:** 20/20 satisfied (CMPT, MEAS, RUN, PKG, OPS)

### Delivered

Migrated the Node/npm toolchain to Bun across runtime, package management, and Docker/CI — gated on real before/after measurements, with a one-change Node fallback retained at every layer. Bun is now the default server runtime, package manager, and production image base; the `oven/bun` arm64 container builds and serves `/health` 200 on the Oracle VPS.

### Key Accomplishments

1. **Compatibility proven before commitment** (Phase 4) — Mongo driver, `amqplib`, Stripe async webhook crypto, and `@rdkit/rdkit` WASM all run under Bun 1.3.14 on arm64 in the `oven/bun` container; Node baselines captured (median-of-N) to BASELINE.md.
2. **Express API on Bun, RAM gate PASS** (Phase 5) — Bun median idle RSS 115.1 MiB < 118.9 MiB Node baseline (MEAS-03); dev `--watch` reload + prod smoke (auth, Stripe webhook via `constructEventAsync`, token consumption) green under both runtimes.
3. **Package management on `bun install`** (Phase 6) — Bun-default `install`/`dev`/`build`/`start` scripts with `:node` fallbacks; dual `bun.lock` + `package-lock.json` for root/client/server; Vite build invoked through Bun.
4. **Docker + CI + scripts on Bun** (Phase 7) — production `Dockerfile` on pinned `oven/bun:1.3.14-slim` (arm64), deploy pipeline builds it on the box and serves `/health` 200 on the VPS; `check`/`test:brand`/`test:stripe` run under Bun (Stripe test fixed for Bun SubtleCrypto via `generateTestHeaderStringAsync`).
5. **Node rollback retained throughout** — `:node` script aliases at every layer plus a documented one-edit `Dockerfile` revert (ROLLBACK.md).

### Git Range

`8f43077` (docs: research phase 04) → `88ccf14` (docs(07): verification passed 10/10)

---

## v1 — ChemBench Cleanup

**Shipped:** 2026-06-04
**Phases:** 3 | **Plans:** 3
**Requirements:** 10/10 satisfied

### Delivered

Removed all Pyxis Discovery branding, cleaned up debug-era code in the sign-in page, and established a GitHub Actions CI/CD deploy pipeline to an Oracle arm64 VPS.

### Key Accomplishments

1. Zero pyxis references in source — `npm run test:brand` guards future regressions
2. `sign-in.jsx` cleaned to 34 lines — no third-party IP calls, no hardcoded usernames, no console leaks
3. Native arm64 deploy pipeline via SSH/SCP — builds in ~30s with no QEMU or registry dependency
4. All 10 v1 requirements satisfied across 3 phases

### Git Range

`d71efdf` (feat: rebrand) → `0e82571` (docs: phase 3 tracking)

---

*Updated: 2026-06-04*
