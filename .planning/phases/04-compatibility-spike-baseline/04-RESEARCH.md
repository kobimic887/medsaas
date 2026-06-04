# Phase 4: Compatibility Spike + Baseline - Research

**Researched:** 2026-06-04
**Domain:** Bun runtime compatibility (arm64) for an Express/MongoDB/RabbitMQ/Stripe/RDKit-WASM app + baseline performance measurement methodology
**Confidence:** HIGH (core dep compat empirically verified on this machine under Bun 1.3.14; baseline methodology MEDIUM — prescriptive but not yet run)

## Summary

This phase is an **empirical spike**, not a build. The research goal is to tell the planner (1) which Bun compatibility gotchas are already known so the spike confirms rather than discovers them, (2) how to structure a credible throwaway spike, and (3) a low-variance method for capturing Node baselines. Most dep-compat questions were resolvable **right now** because Bun 1.3.14 is already installed on this arm64 host, so this research includes real probe results rather than training-data guesses.

**Headline finding (verified):** The Stripe SDK's **synchronous `webhooks.constructEvent()` — the exact call in production at `server/index.js:99` — FAILS under Bun** with `SubtleCryptoProvider cannot be used in a synchronous context`. Bun reports `process.versions.bun`, so the Stripe SDK selects its async-only WebCrypto provider. The fix is a one-line change to `constructEventAsync()` + `await`. `createNodeCryptoProvider()` is **not** available under Bun, so it is not an escape hatch. This breaks CMPT-04 *and* the existing `server/test/stripe-webhook.test.mjs` until the code is changed. This is precisely the gotcha the spike exists to surface.

**Other verified findings:** `mongodb`, `amqplib`, `stripe`, `express` all import cleanly under Bun. `@rdkit/rdkit` WASM **loads and runs** (version 2025.03.4, parsed benzene). `@rdkit/rdkit` is **installed in `server/package.json` but imported nowhere in the codebase** — CMPT-05 must be proven by a standalone spike script, not an existing route.

**Primary recommendation:** Build the spike as a throwaway `spike/` directory of small standalone Bun scripts (one per dependency, each doing one real operation against a live local service), plus a baseline-capture script run under Node first. Treat the Stripe sync→async change as a *known required* Phase 5 code edit, surfaced here so the planner scopes it. Commit baseline numbers as a markdown file in the repo.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Express boot + `/health` | API / Backend | — | The runtime swap is server-side only; client (Vite) is out of scope this phase |
| MongoDB connect/query/index | Database / Storage | API / Backend | Driver runs in the API process; needs a live Mongo |
| amqplib publish/consume | API / Backend | — | RabbitMQ client runs in API process; needs a live broker |
| Stripe webhook verify | API / Backend | — | HMAC verification is server-side crypto; the failing path |
| RDKit WASM load | API / Backend | — | WASM instantiated in the server process (though currently unused) |
| oven/bun container build/run | CDN / Static (image) | API / Backend | Container is the prod deployment unit for the API |
| Baseline metrics capture | API / Backend | Ops / CI | RSS/cold-start measured on the API process; CI wall-clock from Actions |

## Standard Stack

This phase introduces **no new runtime dependencies**. The "stack" is the Bun toolchain plus the existing deps under test.

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Bun | 1.3.14 (installed) | Runtime under test | Already installed on this arm64 host [VERIFIED: `bun --version`] |
| `oven/bun` Docker image | 1.3.14-slim (recommended) | Container base for CMPT-06 | Official Bun image, multiplatform arm64+x64 [CITED: hub.docker.com/r/oven/bun/tags] |

### Existing deps under test (no version change)
| Library | Version (server/package.json) | Bun status |
|---------|------------------------------|-----------|
| `express` | ^4.18.2 | Imports OK [VERIFIED: bun probe] |
| `mongodb` | ^6.17.0 | Imports OK; driver explicitly hardened for non-Node runtimes [VERIFIED: bun probe] + [CITED: mongodb.com bun-with-mongodb] |
| `amqplib` | ^0.10.9 | Imports OK; connection bug fixed (see Pitfalls) [VERIFIED: bun probe] |
| `stripe` | ^18.3.0 | Imports OK; **sync `constructEvent` BROKEN** (see Pitfalls) [VERIFIED: bun probe] |
| `@rdkit/rdkit` | ^2025.3.4-1.0.0 | WASM loads + runs [VERIFIED: bun probe, version 2025.03.4] |

### oven/bun image variants
| Tag | Use | Notes |
|-----|-----|-------|
| `oven/bun:1.3.14-slim` | **Recommended for this app** | Debian-based, glibc — safest for WASM + any native bits [CITED: hub.docker.com] |
| `oven/bun:1.3.14-alpine` | Smallest | musl libc — historically risky for native/WASM modules; only if slim proves too large |
| `oven/bun:1.3.14-distroless` | Hardened prod | No shell — `wget`/`curl` healthcheck in `docker-compose.box.yml` would break; avoid for now |

**Pin the exact version (`1.3.14-...`), not floating `latest`/`1`** — the spike's credibility depends on a known runtime version matching what Phase 7 ships.

**Installation:** None — Bun already installed. Image pulled at build time:
```bash
docker pull oven/bun:1.3.14-slim   # verify arch with: docker image inspect ... | grep Architecture
```

**Version verification:**
```bash
bun --version            # → 1.3.14 [VERIFIED]
uname -m                 # → arm64 [VERIFIED]
docker pull oven/bun:1.3.14-slim   # confirm tag exists at execution time
```

## Package Legitimacy Audit

> No new external packages are installed in this phase. The deps under test are already in `server/package.json` and were vetted in v1. slopcheck not required.

| Package | Registry | Disposition |
|---------|----------|-------------|
| (none new) | — | N/A — spike uses only existing, already-installed deps |

If the spike adds a tiny load generator, prefer a built-in (`bun`'s `fetch` in a loop, or `autocannon` only if justified). Any new dev dep must be slopchecked at plan time.

## Architecture Patterns

### System Architecture Diagram

```
                    SPIKE (throwaway, isolated in spike/)
                    =====================================

  [Node baseline run]                      [Bun compat run]
         │                                        │
         ▼                                        ▼
  baseline-capture.mjs  ──writes──►  BASELINE.md   spike scripts (Bun)
  (node)                            (committed)     ┌──────────────────────┐
   ├─ cold npm install timing                       │ 01-boot-health.ts    │──► GET /health → 200
   ├─ cold-start timing (spawn→/health)             │ 02-mongo.ts          │──► connect/query/createIndex
   ├─ RSS idle (VmRSS / container stats)            │ 03-amqp.ts           │──► publish + consume 1 msg
   └─ RSS under load (load-gen → endpoints)         │ 04-stripe.ts         │──► constructEventAsync verify
                                                     │ 05-rdkit.ts          │──► load WASM + get_mol
                                                     └──────────────────────┘
                                                              │
   load-gen.mjs ──N concurrent requests──► server            ▼
   (same generator used for Node + Bun)            06-docker: oven/bun:1.3.14-slim
                                                    build + run + /health → 200 (CMPT-06)

  Live local services (docker compose up -d mongo rabbitmq):
     MongoDB :27017      RabbitMQ :5672
```

Data flow to trace: a reviewer runs `baseline-capture.mjs` under Node → numbers land in `BASELINE.md`; then runs each `spike/0N-*.ts` under Bun against the same live Mongo/RabbitMQ → each prints PASS with evidence of a real operation; finally builds the oven/bun image and curls `/health`.

### Recommended Project Structure
```
spike/                      # throwaway — gitignored EXCEPT results, or deleted after Phase 5
├── README.md               # how to run, what each script proves, results table
├── 01-boot-health.ts       # boot real server under Bun, assert /health 200
├── 02-mongo.ts             # connect + insert/find + createIndex (CMPT-02)
├── 03-amqp.ts              # assertQueue + publish + consume one message (CMPT-03)
├── 04-stripe.ts            # constructEventAsync signature verify (CMPT-04)
├── 05-rdkit.ts             # initRDKitModule + get_mol("c1ccccc1") (CMPT-05)
├── Dockerfile.bun          # oven/bun:1.3.14-slim, build + run server (CMPT-06)
└── load-gen.mjs            # shared load generator (Node + Bun, same code)

.planning/phases/04-compatibility-spike-baseline/
└── BASELINE.md             # COMMITTED Node baselines (MEAS-01 deliverable)
```

### Pattern 1: One real operation per dependency
**What:** Each spike script does the *minimum operation that exercises the risky code path*, not just an import.
**When to use:** All CMPT scripts.
**Examples of "a real operation":**
- MongoDB (CMPT-02): `connect()` → `insertOne` → `findOne` → `createIndex` against live Mongo. Index creation specifically mirrors the startup path in `server/index.js:715-723`.
- amqplib (CMPT-03): `connect` → `createChannel` → `assertQueue(durable)` → `publish` → `consume` and assert the message round-trips. Mirror `server/utils/rabbitMQUtils.js`.
- Stripe (CMPT-04): build a signed header with `node:crypto` HMAC, then `await stripe.webhooks.constructEventAsync(payload, header, secret)` and assert `event.type`.
- RDKit (CMPT-05): `initRDKitModule()` → `get_mol("c1ccccc1")` → `mol.is_valid()`. [VERIFIED working]

### Pattern 2: Same generator, same machine, median of N (baselines)
**What:** Capture every metric N times (N≥5) on the **same host**, report the **median**, never a single run.
**When to use:** All MEAS-01 metrics. See Common Pitfalls for the invalidating mistakes.

### Anti-Patterns to Avoid
- **Proving compat by import alone:** importing `stripe` "works" but the sync webhook path still fails. Always run the operation.
- **Editing `server/index.js` during the spike:** the spike must prove the *unmodified* app boots (CMPT-01). The Stripe code fix belongs to Phase 5; the spike proves the fix is needed and that `constructEventAsync` is the answer.
- **Comparing Node-on-mac to Bun-on-VPS:** different machine = invalid baseline. Capture Node and (later) Bun on the *same* host.
- **Floating image tags:** `oven/bun:latest` makes the spike non-reproducible.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| HMAC webhook verify under Bun | Custom HMAC compare | `stripe.webhooks.constructEventAsync()` | Stripe handles timestamp tolerance + timing-safe compare; only the async variant works under Bun |
| RSS measurement | Parsing `top` output | `/proc/<pid>/status` VmRSS (Linux) or `docker stats` | Stable, scriptable, same boundary for both runtimes |
| Load generation | ad-hoc curl loops with no concurrency | a small fixed-concurrency `fetch` loop (or `autocannon` if justified) | Reproducible concurrency/duration; same code for Node and Bun |
| Cold-start timing | eyeballing logs | spawn process → poll `/health` until 200 → record delta | Removes human-timing variance |

**Key insight:** The spike's value is *credibility*. Hand-rolled measurement injects variance and makes the before/after report (Phase 5, MEAS-02/03) arguable. Use deterministic, identical methods for Node and Bun.

## Common Pitfalls

### Pitfall 1: Stripe sync webhook verification fails under Bun (CRITICAL, VERIFIED)
**What goes wrong:** `stripe.webhooks.constructEvent(...)` throws `SubtleCryptoProvider cannot be used in a synchronous context`. Production code (`server/index.js:99`) and `server/test/stripe-webhook.test.mjs` both use the sync form.
**Why it happens:** Bun sets `process.versions.bun`; the Stripe SDK's runtime detection then picks the async WebCrypto (`SubtleCryptoProvider`) instead of the Node sync provider. `createNodeCryptoProvider()` explicitly errors under Bun ("not available in non-Node environments").
**How to avoid:** Use `await stripe.webhooks.constructEventAsync(...)` [VERIFIED: returns the event correctly under Bun 1.3.14]. This is a **required Phase 5 code change** in the `/stripe/webhook` handler and the stripe test. The spike script should use the async form to prove CMPT-04 passes.
**Warning signs:** Webhook returns 400 "signature verification failed" or a synchronous-context throw the moment a webhook arrives under Bun.

### Pitfall 2: @rdkit/rdkit is installed but never imported
**What goes wrong:** A reviewer assumes CMPT-05 is covered by an existing route. It is not — `grep` finds zero imports of `@rdkit/rdkit` / `initRDKitModule` in app code.
**Why it happens:** Vestigial dependency from earlier work; RDKit fingerprinting referenced only in swagger enums, not implemented server-side.
**How to avoid:** Prove CMPT-05 with a standalone spike script loading `node_modules/@rdkit/rdkit/dist/RDKit_minimal.js` and calling `initRDKitModule()`. [VERIFIED working under Bun] Flag to planner: this dep may be removable in a later milestone, but that's out of scope here.

### Pitfall 3: amqplib connection bug — stale issue, but a residual open one exists
**What goes wrong:** Older guidance says amqplib "doesn't connect in Bun."
**Why it happens:** That was oven-sh/bun#4791 — reported against **Bun 1.0.0**, **CLOSED/COMPLETED 2024-06-10** [VERIFIED: gh issue view]. It is fixed in 1.3.14. **However**, oven-sh/bun#5627 ("RabbitMQ / amqplib Invalid frame") remains **open** [VERIFIED: gh search]. So connection is fixed; a protocol-framing edge case may still surface.
**How to avoid:** Do not cite #4791 as a current blocker. **Empirically run a real publish+consume** against local RabbitMQ during the spike (Docker is currently DOWN on this machine, so this could not be pre-verified — it is the one CMPT dep whose live operation is still UNVERIFIED). If "Invalid frame" appears, that's the #5627 signature — capture it as a finding.

### Pitfall 4: CMPT-01 boot is NOT zero-dependency
**What goes wrong:** Assuming `/health` returns 200 from a bare boot.
**Why it happens:** `server/index.js` validates `MONGODB_URI`, `JWT_SECRET` (≥32 chars), `STRIPE_SECRET_KEY` at startup and connects to Mongo before serving.
**How to avoid:** The CMPT-01 spike must supply valid env vars and a reachable Mongo (use `npm run services:up`). The Mongo connect is part of boot, so CMPT-01 and CMPT-02 share preconditions.

### Pitfall 5: Baseline validity traps (MEAS-01)
**What goes wrong:** Numbers that can't be fairly compared in Phase 5.
**How to avoid:**
- **RSS:** measure at the **same boundary** for Node and Bun. Prefer `/proc/<pid>/status` VmRSS (Linux) or `docker stats` over `process.memoryUsage().rss` (which reports per-runtime heap accounting differently). Same machine, median of N.
- **"Under load":** define which endpoints. Heavy science routes (MolMIM, OpenFold3, Tanimoto, ADMET) hit external APIs and are non-deterministic — **exclude them**. Use representative self-contained routes (e.g. `/health`, `/health/db`, an auth or token-check path) under fixed concurrency for a fixed duration. `/health` alone is too trivial to show RSS-under-load.
- **Cold npm install:** `rm -rf node_modules ~/.npm/_cacache` (or `npm cache clean --force`) before each timed run; median of N.
- **Cold-start:** spawn → poll `/health` until 200 → record ms; median of N.
- **CI wall-clock:** comes from the `deploy.yml` `workflow_dispatch` run (native build-on-box via `docker compose -f docker-compose.box.yml up --build`, no registry). Record the Actions job duration.

## Code Examples

Verified patterns from this session's probes (Bun 1.3.14, macOS arm64):

### Stripe webhook verification that WORKS under Bun (CMPT-04)
```ts
// Source: VERIFIED probe this session. Mirrors server/index.js:99 but async.
import Stripe from "stripe";
import crypto from "node:crypto";
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
const secret = process.env.STRIPE_WEBHOOK_SECRET!;
const payload = JSON.stringify({ id: "evt_1", type: "checkout.session.completed", data: { object: {} } });
const ts = Math.floor(Date.now() / 1000);
const sig = crypto.createHmac("sha256", secret).update(`${ts}.${payload}`, "utf8").digest("hex");
const header = `t=${ts},v1=${sig}`;
// ❌ stripe.webhooks.constructEvent(...)  → throws under Bun
const event = await stripe.webhooks.constructEventAsync(payload, header, secret); // ✅ works
console.log("verified:", event.type);
```

### RDKit WASM load + real op (CMPT-05)
```ts
// Source: VERIFIED probe this session → "RDKit version: 2025.03.4", benzene valid.
import initRDKitModule from "./node_modules/@rdkit/rdkit/dist/RDKit_minimal.js";
const RDKit = await initRDKitModule();
const mol = RDKit.get_mol("c1ccccc1");
console.log(RDKit.version(), mol.is_valid());
mol.delete();
```

### Bun runtime identity (why Stripe mis-detects)
```ts
// Source: VERIFIED probe this session.
process.versions.node;  // "24.3.0"  (Bun emulates a Node version...)
process.versions.bun;   // "1.3.14"  (...but ALSO sets this — Stripe keys off non-Node)
```

## Runtime State Inventory

> This is a spike, not a rename/refactor — no string replacement or data migration. Section included for completeness; nearly all categories are N/A.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — spike does not migrate data. Spike Mongo writes go to a throwaway test DB | None — drop test DB after |
| Live service config | None changed. Spike *consumes* local Mongo/RabbitMQ but alters no prod config | None |
| OS-registered state | None | None |
| Secrets/env vars | Spike needs valid `MONGODB_URI`, `JWT_SECRET`≥32, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `RABBITMQ_URL` to boot the server — no new keys, reuse existing names | None — reuse |
| Build artifacts | A throwaway oven/bun image (`medsaas:bun-spike` or similar) is built for CMPT-06 | `docker image prune` after spike; do not push to registry |

## Common Pitfalls (summary for verification steps)

Verification steps in the plan should check for: (1) Stripe spike uses `constructEventAsync`, not sync; (2) RDKit proven by standalone script, not assumed via a route; (3) amqplib spike does a live publish+consume (not import-only); (4) baselines captured median-of-N on one machine; (5) `oven/bun` tag is version-pinned.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| "amqplib can't connect in Bun" (#4791) | Fixed; connects fine | Bun fix merged, issue closed 2024-06-10 | Don't treat as blocker; still verify live (#5627 open) |
| MongoDB driver patched per-runtime | Driver uses `node:process` imports + standards-based APIs for non-Node runtimes | mongodb v6.x line | MongoDB is the lowest-risk dep here |
| `createNodeCryptoProvider()` for Stripe in alt runtimes | Unavailable under Bun; must use `constructEventAsync` + SubtleCrypto | Stripe SDK runtime detection | The single required code change for CMPT-04 |

**Deprecated/outdated:**
- Citing oven-sh/bun#4791 as a present amqplib blocker — it's fixed.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `oven/bun:1.3.14-slim` builds + runs this server on arm64 | Standard Stack | CMPT-06 needs a different variant (alpine/debian); medium — easy tag swap |
| A2 | amqplib publish+consume works live under Bun 1.3.14 (connection fixed, but live op NOT run — Docker down this session) | Pitfall 3 | If #5627 "Invalid frame" recurs, CMPT-03 needs a workaround/version bump; this is the one unverified CMPT dep |
| A3 | `docker-compose.box.yml` healthcheck uses `wget` (present in slim, absent in distroless) | Standard Stack | If distroless chosen, container healthcheck breaks; low — recommending slim avoids it |
| A4 | Excluding external-API science routes from "under load" yields a representative-enough load | Pitfall 5 | Baseline may under-represent real RAM; medium — document which routes were used |

**Note:** A2 is the most important assumption to resolve during execution — bring up Docker and run the live publish/consume first.

## Open Questions

1. **Does amqplib publish/consume actually round-trip under Bun 1.3.14?**
   - What we know: imports OK; connection bug (#4791) fixed 2024; #5627 framing bug still open.
   - What's unclear: live behavior — Docker was DOWN this session so it could not be probed.
   - Recommendation: First spike task — `npm run services:up`, then run `spike/03-amqp.ts`. If "Invalid frame" appears, capture and consider an amqplib version bump.

2. **Which endpoints constitute "representative load" for RSS?**
   - What we know: science routes hit external APIs (non-deterministic); `/health` is too trivial.
   - What's unclear: exact mix.
   - Recommendation: Use `/health`, `/health/db`, and a lightweight auth/token-check path at fixed concurrency; document the choice in `BASELINE.md` so Phase 5 reuses it identically.

3. **Keep or delete `spike/` after the phase?**
   - Recommendation: Delete the scripts after Phase 5 consumes them, but **commit `BASELINE.md`** (MEAS-01 is "recorded in the repo"). Optionally keep `load-gen.mjs` since MEAS-02 reuses it.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Bun | All CMPT + Bun-side baselines | ✓ | 1.3.14 | — |
| Docker | CMPT-06 (image), live Mongo/RabbitMQ for CMPT-02/03 | ✗ (DOWN this session) | — | Start Docker Desktop; `npm run services:up` |
| MongoDB (local) | CMPT-01/02 boot + query | via Docker | mongo:7 (compose) | Atlas (but prefer local for spike isolation) |
| RabbitMQ (local) | CMPT-03 | via Docker | (compose `rabbitmq`) | none — required for live publish/consume |
| `oven/bun:1.3.14-slim` image | CMPT-06 | pull at build | 1.3.14 | alpine/debian variant |
| Node | Baseline (Node side of MEAS-01) | ✓ | v22.22.3 | — |
| `gh` CLI | (research only) | ✓ | — | — |

**Missing dependencies with no fallback:** RabbitMQ for CMPT-03 — must start Docker.
**Missing dependencies with fallback:** Docker is required but currently stopped; starting Docker Desktop resolves Mongo + RabbitMQ + image build in one step.

## Validation Architecture

> nyquist_validation not disabled in config → section included. Note: project has **no general test framework** (`check` = syntax + client build); the only test is the bespoke stripe webhook script.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | None (no jest/vitest/mocha). Bespoke `node:`-script tests only |
| Config file | none |
| Quick run command | `node --check server/index.js` (syntax) |
| Full suite command | `npm run check` (syntax + client build); `npm --prefix server run test:stripe` (webhook) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CMPT-01 | Express boots under Bun, `/health` 200 | smoke | `bun run spike/01-boot-health.ts` | ❌ Wave 0 |
| CMPT-02 | Mongo connect/query/index under Bun | integration | `bun run spike/02-mongo.ts` | ❌ Wave 0 |
| CMPT-03 | amqplib publish+consume under Bun | integration | `bun run spike/03-amqp.ts` | ❌ Wave 0 |
| CMPT-04 | Stripe webhook verify under Bun | integration | `bun run spike/04-stripe.ts` | ❌ Wave 0 |
| CMPT-05 | RDKit WASM load+op under Bun | unit | `bun run spike/05-rdkit.ts` | ❌ Wave 0 (pattern VERIFIED) |
| CMPT-06 | oven/bun image builds + serves /health | integration | `docker build -f spike/Dockerfile.bun . && docker run ... && curl /health` | ❌ Wave 0 |
| MEAS-01 | Node baselines captured + committed | manual+script | `node spike/baseline-capture.mjs` → `BASELINE.md` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** run that task's spike script and confirm PASS.
- **Per wave merge:** run all `spike/0*.ts` against live services.
- **Phase gate:** all 6 CMPT scripts PASS + `BASELINE.md` committed before `/gsd:verify-work`.

### Wave 0 Gaps
- [ ] `spike/0[1-5].ts` + `spike/Dockerfile.bun` — one per CMPT requirement
- [ ] `spike/baseline-capture.mjs` + `spike/load-gen.mjs` — MEAS-01
- [ ] `BASELINE.md` — committed deliverable
- [ ] Docker started + `npm run services:up` — precondition for CMPT-01/02/03/06

## Security Domain

> `security_enforcement` not set to false → included. This phase changes no auth/access logic; it only verifies existing behavior survives a runtime swap.

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no (verify-only) | Existing JWT/bcrypt unchanged |
| V3 Session Management | no | Unchanged |
| V4 Access Control | no | Unchanged |
| V5 Input Validation | no | Unchanged |
| V6 Cryptography | **yes** | Stripe webhook HMAC — the failing path; must verify `constructEventAsync` is timing-safe (it is, SDK-handled) |

### Known Threat Patterns for Bun-migrated Stripe webhook
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Webhook signature silently not verified after sync→async swap | Spoofing | Spike must assert a *tampered* payload is REJECTED, not only that a valid one passes |
| Replay (old timestamp) | Tampering | `constructEventAsync` enforces timestamp tolerance — keep default tolerance, test an expired `t=` |
| Credentials in committed spike files | Info Disclosure | Spike reads secrets from env, never hardcodes; `.gitignore` any local `.env` used |

**Critical security verification for CMPT-04:** the spike must prove a *bad* signature is rejected under Bun (negative test), not just that a good one passes — otherwise an accidentally-disabled verification path would look like success.

## Sources

### Primary (HIGH confidence)
- **Empirical probes, Bun 1.3.14 / macOS arm64, this session** — dep imports, Stripe sync-fail + async-pass, RDKit WASM load (v2025.03.4), `process.versions` identity
- `gh issue view 4791 --repo oven-sh/bun` → CLOSED/COMPLETED 2024-06-10
- `gh search issues oven-sh/bun amqplib --state open` → #5627 still open
- Local files: `server/index.js` (health, webhook, Mongo indexes), `server/utils/rabbitMQUtils.js`, `Dockerfile`, `docker-compose.box.yml`, `.github/workflows/deploy.yml`, `server/test/stripe-webhook.test.mjs`

### Secondary (MEDIUM confidence)
- Bun Node.js compatibility docs — bun.com/docs/runtime/nodejs-compat
- oven/bun Docker tags — hub.docker.com/r/oven/bun/tags (1.3.14 variants confirmed, ~20 days old)
- MongoDB + Bun — mongodb.com/developer/languages/javascript/bun-with-mongodb (driver hardened for non-Node)

### Tertiary (LOW confidence — verify in execution)
- amqplib live publish/consume under Bun — inferred fixed from #4791 closure; NOT run live (Docker down). Verify first.

## Metadata

**Confidence breakdown:**
- Dep compatibility: HIGH — 4/5 deps probed live under Bun; Stripe fix verified end-to-end; RDKit verified end-to-end. amqplib live op is the lone gap.
- oven/bun image: MEDIUM — tags confirmed current; build-on-this-app not yet run.
- Baseline methodology: MEDIUM — prescriptive and grounded in real validity traps, but not yet executed.
- Stripe gotcha (headline): HIGH — reproduced deterministically.

**Research date:** 2026-06-04
**Valid until:** ~2026-07-04 (Bun moves fast; re-verify Stripe behavior if Bun or `stripe` SDK is bumped before execution)
