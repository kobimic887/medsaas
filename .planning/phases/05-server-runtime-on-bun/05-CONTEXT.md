# Phase 5: Server Runtime on Bun - Context

**Gathered:** 2026-06-04
**Status:** Ready for planning

<domain>
## Phase Boundary

Make the existing Express API **run on the Bun runtime** in both dev and production, replacing `node` as the runtime binary — proving behavior is identical (auth, Stripe billing webhook, one token-consuming simulation endpoint), measuring RAM/startup before-vs-after against the Phase 4 Node baseline, and keeping Node as a one-command rollback. This is the real production cutover, not the throwaway spike.

**In scope:** swap the runtime binary (`node` → `bun`) inside the existing `dev` / `start` / `start:unified` scripts; the required Stripe sync→async webhook fix; a scripted smoke test (auth + Stripe webhook + token middleware); a Bun-vs-Node before/after RAM + startup report with a default-runtime gate; retained Node fallback scripts.

**Out of scope (other phases):**
- **Phase 6** — `bun install` / `bun.lock`, migrating scripts to be invoked *through* `bun` as the package/script runner, client dep migration. Phase 5 keeps scripts invoked by **npm**; only the runtime binary inside them changes.
- **Phase 7** — the `oven/bun` Docker image, GitHub Actions CI on Bun, `check`/`test:*` under Bun. "Production on Bun" in Phase 5 means the bun-run prod server serving the built frontend + passing smoke tests on a host — NOT the containerized/CI deploy.
</domain>

<decisions>
## Implementation Decisions

### Run scripts & default runtime (RUN-01, RUN-02)
- **D-01:** Bun becomes the **default immediately** — swap `node` → `bun` inside the existing scripts: `server` `dev` (`bun --watch index.js`), `start` (`bun index.js`), `start:unified` (`FRONTEND_DIST=../client/dist bun index.js`). Root `start`/`dev` keep their current shape (npm-invoked, `predev` hook and `concurrently` preserved) — only the runtime binary the script calls changes.
- **D-02:** Scripts stay **invoked by npm** in Phase 5. Do NOT convert to `bun run` / `bun install` here — that is Phase 6. ("Bun default immediately" = the runtime binary is Bun, not "everything runs through Bun's package tooling.")
- **D-03:** Dev `web` side (Vite client) stays on the existing npm/node toolchain — the bundler swap is out of the whole milestone.

### Node fallback / rollback (RUN-04)
- **D-04:** Add parallel **`*:node` fallback scripts** (e.g. `start:node`, `dev:node`, `start:unified:node`) that run the server on `node`. These are the retained, documented one-command rollback. README/docs must show the exact rollback command.

### RAM gate & before/after report (MEAS-02, MEAS-03)
- **D-05:** Reuse the **Phase 4 measurement harness as-is** — `spike/load-gen.mjs`, N=5, `/health` + `/health/db` endpoint mix, `/proc/<pid>/status` VmRSS boundary — to capture Bun metrics comparable to `BASELINE.md`. (Note: `spike/baseline-capture.mjs` was written for Node; planner must produce a Bun-capable capture path that yields the same metrics with the same method.)
- **D-06:** **Gate rule = "any reduction → Bun"**: if Bun's median idle RSS is lower than the Node baseline, Bun stays the default; if Bun does **not** reduce idle RSS, the default **reverts to Node** (the `*:node` scripts make this a one-line flip) and the report documents it. This reconciles the user's "Bun default immediately" choice with locked roadmap success criterion #4 — Bun is default *during* the phase, but the MEAS-03 gate has final say on the shipped default.
- **D-07:** Because the gate triggers on "any reduction," the before/after report MUST show **per-sample distributions, not just medians** (Phase 4 idle RSS ranged ~111–122 MiB around a 118.9 median — wider than a small "reduction"), so the default isn't flipped on measurement noise. Measure Bun and Node back-to-back on the same machine (oracle).

### Stripe webhook async cutover (RUN-03)
- **D-08:** Apply the `STRIPE-HANDOFF.md` fix: replace `stripe.webhooks.constructEvent()` at `server/index.js:99` with `constructEventAsync()`, and update `server/test/stripe-webhook.test.mjs` to `await`.
- **D-09 [CRITICAL — anti-shallow]:** Phase 4's CMPT-04 ✓ is **NOT** proof the production webhook works under Bun. `spike/04-stripe.ts` called `constructEventAsync()` directly on a hand-built string — it never went through Express, `express.raw()`, or a real HTTP request. The RUN-03 smoke test MUST exercise the **real Express webhook route end-to-end** (signed request → `express.raw` body → `constructEventAsync`) under Bun. A standalone-script re-run does not satisfy RUN-03.

### Smoke test scope & method (RUN-03)
- **D-10:** **Scripted** smoke test (not a manual checklist), reusing Phase 4's `oracle` execution path. It must cover: (1) auth login returns a valid JWT, (2) the real Stripe webhook route verifies a signed event end-to-end (see D-09), (3) the `consumeSimulationToken` middleware on one **cheap** token-consuming endpoint — assert token decrement and/or 402 when tokens are exhausted, **without** calling the external science service.

### Claude's Discretion
- **Stripe code-path shape:** user deferred ("idk & idc") on unconditional-async vs runtime-branched → **decision: unconditional `constructEventAsync()`** (it works on Node too, so one code path serves both runtimes and keeps the Node fallback simple). Planner/executor may adjust only if a Node-version incompatibility surfaces.
- Exact `*:node` script naming, the specific cheap token endpoint chosen for the smoke test, and the smoke-test harness shape (extend `test:stripe` style vs new script) are left to research/planning.
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase scope & requirements
- `.planning/ROADMAP.md` — Phase 5 section: goal, 4 success criteria (esp. #4 = Node-default-unless-RAM-win gate, which is LOCKED), depends-on Phase 4.
- `.planning/REQUIREMENTS.md` — RUN-01..04, MEAS-02, MEAS-03 definitions; "Out of Scope" table (bundler swap, Python services, Node-fallback retention).

### Phase 4 carry-over (the inputs this phase builds on)
- `.planning/phases/04-compatibility-spike-baseline/BASELINE.md` — Node baseline medians + methodology; the before/after report compares against this.
- `spike/STRIPE-HANDOFF.md` — the production Stripe sync→async migration this phase must execute.
- `spike/load-gen.mjs` — reusable load generator for MEAS-02 (reuse as-is).
- `spike/baseline-capture.mjs` — Node baseline capture (reference for the Bun capture; was Node-specific).
- `.planning/phases/04-compatibility-spike-baseline/04-RESEARCH.md` — Bun compat findings, incl. the Stripe `SubtleCryptoProvider` sync failure.

### Production code touch points
- `server/index.js` §~99 — the Stripe webhook handler (`express.raw` route + `constructEvent`) to migrate.
- `server/test/stripe-webhook.test.mjs` — webhook test to update to async.
- `server/package.json` — `start` / `dev` / `start:unified` / `test:stripe` scripts to migrate + add `*:node` fallbacks.
- `package.json` (root) — `start` / `dev` / `predev` / `concurrently` orchestration (preserve shape).
- `./CLAUDE.md` — middleware chain (`ensureMongoConnected → authenticateToken → requireActiveUser → consumeSimulationToken`), env-var startup validation, static-serving via `FRONTEND_DIST`.
</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `spike/load-gen.mjs` — runtime-agnostic load generator; reuse directly for Bun RSS-under-load.
- `spike/baseline-capture.mjs` — capture harness (VmRSS, median-of-N); adapt for Bun.
- `BASELINE.md` — the comparison target for MEAS-02/03.
- `server/test/stripe-webhook.test.mjs` — existing webhook test scaffold to extend for the end-to-end async smoke test.

### Established Patterns
- Server is ESM (`server/package.json` `type: module`), single `server/index.js`, started via npm scripts.
- Production serving: `FRONTEND_DIST=../client/dist` → Express static-serves the built client (`server/index.js:6014`); `app.listen(PORT, '0.0.0.0')` at `server/index.js:4740`.
- Startup validates `MONGODB_URI`, `JWT_SECRET` (≥32), `STRIPE_SECRET_KEY` — smoke/measurement runs must supply these.
- Stripe webhook uses `express.raw()` body + signature verification — the raw-body path is the real Bun risk surface (D-09).

### Integration Points
- Run scripts in `server/package.json` and root `package.json` (the swap site).
- Stripe webhook route in `server/index.js`.
- `consumeSimulationToken` middleware (token economy) — smoke-test target.
- Phase 4 `oracle` Docker/SSH path — smoke + measurement execution host (local Docker unavailable).
</code_context>

<specifics>
## Specific Ideas

- Smoke + measurement run on `ssh oracle` (aarch64), mirroring Phase 4, because local Docker/bun is unavailable.
- The default-runtime flip (Bun↔Node) should be a one-line change enabled by parallel `*:node` scripts, not a code edit.
</specifics>

<deferred>
## Deferred Ideas

- `oven/bun` Docker image, GitHub Actions CI on Bun, `check`/`test:brand`/`test:stripe` under Bun — **Phase 7** (OPS-01..04).
- `bun install` / `bun.lock`, scripts run through Bun's package tooling, client deps — **Phase 6** (PKG-01..03).
- Vite → Bun bundler swap — deferred to a later milestone (out of v2 entirely).

None of the above were re-scoped into Phase 5 — discussion stayed within the runtime-cutover boundary.
</deferred>

---

*Phase: 05-server-runtime-on-bun*
*Context gathered: 2026-06-04*
