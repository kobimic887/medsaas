# Phase 5: Server Runtime on Bun - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-04
**Phase:** 5-server-runtime-on-bun
**Areas discussed:** Run scripts & rollback, RAM gate decision rule, Stripe async cutover, Smoke test + scope

Note: user delegated area selection ("whatever you think we should do"), so all four
identified gray areas were discussed. Recommendations were presented recommendation-first.

---

## Run scripts & rollback (RUN-01/02/04)

| Option | Description | Selected |
|--------|-------------|----------|
| Parallel scripts, flip on gate | Add bun:* scripts; Node default during phase; flip to Bun only if RAM gate passes | |
| Bun default immediately | Swap node→bun in dev/start/start:unified now; add *:node fallback scripts | ✓ |

**User's choice:** Bun default immediately.
**Notes:** Reconciled with locked success criterion #4 — Bun is default during the phase, but the MEAS-03 gate still decides the *shipped* default (reverts to Node if no RAM win). Scripts stay npm-invoked in Phase 5 (Bun-as-package-runner / bun install is Phase 6).

---

## RAM gate decision rule (MEAS-02/03)

| Option | Description | Selected |
|--------|-------------|----------|
| ≥5% idle RSS drop → Bun | Threshold above measurement noise; else Node stays default | |
| Any reduction → Bun | Bun default if idle RSS lower at all; more aggressive, risks noise | ✓ |
| I decide from the report | No fixed threshold; manual call from before/after numbers | |

**User's choice:** Any reduction → Bun.
**Notes:** Because the gate triggers on any reduction, CONTEXT requires the report to show per-sample distributions (not just medians) so the default isn't flipped on noise (Phase 4 idle RSS ranged ~111–122 MiB). Reuse Phase 4 harness as-is.

---

## Stripe async cutover (RUN-03)

| Option | Description | Selected |
|--------|-------------|----------|
| Unconditional async | constructEventAsync() everywhere; one code path for Node+Bun | ✓ (Claude's discretion) |
| Runtime-branched | async only under Bun via process.versions.bun check | |

**User's choice:** "idk & idc" — delegated to Claude.
**Notes:** Chose unconditional async (works on Node too, simplest fallback). Also captured the critical finding that Phase 4 CMPT-04 ✓ does NOT prove the production webhook works under Bun — the smoke test must exercise the real Express express.raw route end-to-end.

---

## Smoke test + scope vs Phase 7

| Option | Description | Selected |
|--------|-------------|----------|
| Scripted on oracle, Docker=P7 | Scripted smoke (auth + real Stripe route + token middleware) on oracle; Docker/CI stay Phase 7 | ✓ |
| Manual smoke checklist | Hand-run checklist against a local/oracle bun server | |

**User's choice:** Scripted on oracle, Docker=P7.
**Notes:** Token-endpoint smoke asserts consumeSimulationToken behavior (decrement / 402) without invoking the external science service. Confirmed Phase 5 stops at bun prod server + built frontend + smoke tests; containerization/CI is Phase 7.

## Claude's Discretion

- Stripe code-path shape → unconditional `constructEventAsync()`.
- `*:node` fallback script naming, specific cheap token endpoint for the smoke test, and smoke-harness shape (extend `test:stripe` vs new script).

## Deferred Ideas

- `oven/bun` Docker image + GitHub Actions CI + check/test scripts on Bun → Phase 7 (OPS-01..04).
- `bun install` / `bun.lock` + scripts run through Bun's package tooling + client deps → Phase 6 (PKG-01..03).
- Vite → Bun bundler swap → later milestone (out of v2).
