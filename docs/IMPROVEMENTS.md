# Improvement Backlog

Prioritized, do-later plan. Effort is rough; risk is "chance of breaking something live."

> **Not critical-path.** Owner decisions and current backlog:
> [`NEXT-SESSION.md`](./NEXT-SESSION.md). Live host is **`84`**; public product is this repo
> on `:5174`. Do **not** polish rollback `:5173`. Apply improvements here only.
> Hardware notes below that say “2 cores / 1 GB” describe historical **`83`**, which is
> imminent shutdown — not a reason to tune live `84` the same way.

---

## Performance — audited 2026-08-01, verified against real fixtures

**Context (historical `83` sizing):** that host was **2 cores / 1 GB RAM**, shared with an
unrelated project and a GROMACS container. Live app host is now **`84`** — re-measure before
RSS panic. Measured data volumes remain *small* — `simulation_logs` held **7 documents**,
`users` ~50, `companies` 1 at audit time — so most items are "correct the shape before it
matters", not live fires.

Measured fixture sizes, from `deploy/box/*/reference/`: a normal docking response is
**222,749 bytes** (the PDB field alone is 210,435); DiffDock success responses are
**111,447–113,979 bytes**, of which ~105,696 is the echoed protein.

### P1. DiffDock writes full scientific payloads to a log file, synchronously — resolved

`server/index.js` used to `JSON.stringify` the whole DiffDock request and response (~200 KB of protein per run) and rotate `diffdock_api.log` with synchronous `existsSync`/`statSync` on the request path.

**Resolution:** logs now record byte counts, status, and a bounded error snippet. Rotation is asynchronous.

`server/index.js:5019, 5035, 5059, 5072` — four of the six `logToFile()` calls stringify a
whole request or response:

```js
logToFile('makeDiffDockRequest REQUEST: ' + JSON.stringify(requestBody));
logToFile('makeDiffDockRequest RESPONSE: ' + text);
```

`requestBody` carries the ~100 KB protein; `text` is the ~111 KB response. So **every DiffDock
run writes ~200 KB+** to `diffdock_api.log`. Worse, `logToFile` (`:7066`) does a **synchronous**
`fs.existsSync()` + `fs.statSync()` on *every* call before appending — blocking syscalls on the
request path of a 2-core box. And at `MAX_LOG_SIZE` (20 MB, `:7063`) the file is **deleted**,
not rotated, so it is neither a reliable audit trail nor bounded in write volume.

**Fix:** log byte counts, status, and a bounded error snippet — not payloads. Drop the sync
`stat` (keep a counter, or let logrotate own the file). **Effort: trivial. Do this one first.**

### P2. `navigate()` waits on a third-party IP lookup

`client/src/pages/dashboard/simulation.jsx:773-825` — after a simulation completes:

```js
const ipResponse = await fetch('https://api.ipify.org?format=json');
const ipData = await ipResponse.json();
...
navigate('/dashboard/molstar3d');
```

No `AbortSignal`, no timeout, no fallback. If ipify or DNS stalls, the user sits on a finished
simulation staring at nothing — **potentially indefinitely**. This is the worst user-facing
item here and it is not volume-dependent.

**Fix:** navigate immediately; collect the IP fire-and-forget. **Effort: trivial.**

### P3. Molstar fetches the same SDF twice, and prices twice

`client/src/pages/dashboard/molstar3d.jsx:695-733` fetches `sdfUrl`, then calls
`loadSdfData(sdfUrl)` (`:132-145`) which fetches **the same URL again** and re-runs a
price lookup per parsed molecule (`:228-255`). The SDF route sets content headers but **no
`Cache-Control`** (`server/index.js:3613-3649`), so the browser will not reliably coalesce them.

**Fix:** pass the already-fetched `sdfText` through instead of the URL; fetch prices once.
**Effort: trivial.**

### P4. Global 8 MB JSON body limit, applied before authentication

`server/index.js:166` — `app.use(express.json({ limit: '8mb' }))` sits above the routes, so
**every** endpoint buffers up to 8 MB before any auth middleware runs. On a 1 GB box, a
handful of concurrent large unauthenticated posts is a plausible memory-exhaustion path.

*No evidence normal traffic does this* — it is exposure, not an observed problem.

**Fix:** small global limit, with a larger parser mounted only on the routes that genuinely
need it. Measure the largest legitimate body first. **Effort: moderate.**

### P5. `/api/simulation` returns 223 KB the dashboard then re-fetches anyway — resolved 2026-08-03

`server/index.js:3460-3473, :3492` returns the full dock result; the client
(`simulation.jsx:758-793`) immediately uses only `simulationKey` to build separate sanitized
PDB/SDF URLs — and fetches those. The big payload is serialised, transferred, and parsed for
nothing on the normal path.

**Resolution:** the dashboard now posts to `/api/simulation?includeResult=false` and receives only
`simulationKey`. GET/POST cache-hit and fresh-result paths retain the full response by default for
existing API/MCP consumers. Runtime smoke coverage pins both response contracts.

### P6. `simulation_logs` has no index, and its list endpoint is unbounded — resolved

Already recorded as [SECURITY-FINDINGS.md](./SECURITY-FINDINGS.md) §A3. Restated here because
it is as much a performance item: the index block (`server/index.js:1106-1118`) creates indexes
for `users`, `companies`, `audit_logs` and `billing_events` and **nothing for
`simulation_logs`** beyond the unique `simulationKey`. `/api/simulation-logs` (`:3514`) has no
`.limit()` and no projection, over documents that each carry a full receptor PDB.

**Resolution:** startup creates tenant/timestamp and cache-lookup indexes for current record
shapes, while `/api/simulation-logs` applies a bounded newest-first limit and excludes the heavy
stored result. Both legacy/current username shapes remain supported for unmigrated accounts.

### Investigated and genuinely fine — do not re-audit

- **Route-level code splitting is real.** `React.lazy` per dashboard page
  (`client/src/routes.jsx:17-51`); Vite separates React/UI/chart chunks
  (`client/vite.config.js:101-119`).
- **No polling loops.** No `setInterval` refetch anywhere; the DiffDock viewer check is a
  one-shot timeout (`moleculeviewer.jsx:250-252`).
- **The rate limiter cannot leak while idle.** Its sweep runs on a later request, and a Map
  that receives no requests receives no entries (`server/index.js:241-260`).
- **The credit path is one atomic update plus an audit insert** — not a read-then-write race
  (`server/index.js:1592-1608, :1653-1657`).
- **`companyBranding.js` bounds `sharp`** — `MAX_LOGO_PIXELS` 16 M, `MAX_LOGO_DIMENSION` 1024.
- **`nvidiaBreaker` is NOT an unbounded cache.** ⚠ An earlier audit claimed it was. It is keyed
  by *service name* (`server/index.js:338-352`), only ever `molmim` and `openfold3`, and expired
  entries are deleted on access. Refuted — do not re-report.
- **`/api/mol-price/count`** (`:2887`) does an unfiltered `countDocuments()`, but **no client
  code calls it** and `mol_price` cardinality is unmeasured. Delete the route or measure it
  before treating it as a finding.

---

## Tier 0 — Quick wins (hours, low risk)

1. **Bump GitHub Actions runtime** *(time-sensitive)*. `actions/checkout@v4` /
   `actions/cache@v4` run on Node 20, which GitHub deprecates **2026-06-16**.
   They keep working, but pin to a Node-24-capable version or set
   `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24=true` in the workflows. — `.github/workflows/*`
   **Completed 2026-06-14:** upgraded to `actions/checkout@v6` and
   `actions/cache@v5`, both of which use the Node 24 action runtime.
2. **Add a Node-path CI leg.** The gate is Bun-only; a `bun run ci:node` matrix
   leg (or a second job) catches Bun-vs-Node divergence the current suite can't.
   — `.github/workflows/ci.yml`
   **Completed 2026-06-14:** added a Node 24 job that installs from all npm
   lockfiles and runs `npm run ci:node`.
3. **Add a linter to the gate.** Biome (single fast binary) or ESLint, run in
   `ci`. Catches the stuff tests don't. — root `package.json`, `ci.yml`
   **Completed 2026-06-16:** added Biome 2.5 (lint-only; Prettier keeps owning
   formatting) as a root devDep, with `biome.json` and a `lint` script chained
   into `bun run ci`. Brownfield introduction — to land green on the existing
   tree without a mass rewrite, rules the tree already violates are relaxed to
   `warn`/`off` (CSS linting disabled so Tailwind directives don't fail). The
   gate still blocks **new** errors: proven by a planted `noAssignInExpressions`
   that fails the run. The config is `biome.jsonc` (comments silently break a
   `.json` Biome config).


   **Cleared and enforced (`error`)** since the introduction:
   - dead code: `noUnusedImports` ×50, `noUnusedVariables` ×59, `useConst` ×16.
   - correctness: `noInnerDeclarations`, `useIterableCallbackReturn`,
     `noPrototypeBuiltins`→`Object.hasOwn`, `noGlobalIsNan`→`Number.isNaN`,
     `useParseIntRadix`.
   - a11y: `useButtonType` ×6, `noSvgWithoutTitle` ×14, `useAltText`,
     `useAriaPropsSupportedByRole`, `noLabelWithoutControl` ×15,
     `useSemanticElements` ×2.

   **Still parked at `warn`/`off`** (need judgment / UX decisions / manual
   testing — the client has no behavioral tests, only a build check):
   - `useKeyWithClickEvents` ×16 (add keyboard handlers — changes runtime
     interaction), `useValidAnchor` ×5 (placeholder `href="#"` links for
     unbuilt features — need real destinations or conversion to buttons),
     `noStaticElementInteractions` ×2.
   - `noUnusedFunctionParameters` (3 legit destructured API props; rest marked
     `_`), `noDangerouslySetInnerHtml` ×3 (intentional), and stylistic rules
     (`useTemplate`, `useOptionalChain`, …) left off.

   The Node leg (`ci:node`) intentionally does not re-run lint — runtime-
   independent, one run is enough.
4. **Client price-display consistency.** In `simulation.jsx`, `PRICE_2MG` has a
   `|| "N/A"` fallback the other weights lack — make them uniform. Trivial. —
   `client/src/pages/dashboard/simulation.jsx`
   **Completed 2026-06-14:** removed the truthy fallback so a missing 2 mg
   price behaves like the other weights and cannot expose an invalid cart action.
5. **Auth/public route cleanup.** **Completed 2026-08-03:** sign-in, reset and
   sign-up requests are lifecycle-safe; the sign-up route no longer imports the large UI
   component library; real marketing routes are available in desktop/mobile navigation; and
   the broken browser-local Blog publisher now redirects old bookmarks to maintained Insights
   content instead of crashing or fabricating public posts. RDKit initialization is now truly
   route-demanded, and invented marketing usage totals were replaced with verifiable capabilities.
   A 18-invariant Bun/Node check pins
   these contracts.

## Tier 1 — Asinex stock feature (continues today's RE; medium)

Builds directly on `server/utils/asinexCompound.js` (pricing + normalizer) and
`docs/ASINEX-ESHOP-REVERSE-ENGINEERING.md`.

6. **Phase 1 — read-only stock.** New `server/services/asinex/` module: a stock
   search client that honours the **async substructure flow** (fire search →
   poll `ReCheckQuery` by `requestid` → fetch), reuses the normalizer, and has
   contract tests against saved/sanitised fixtures. Keep behind the existing
   SSRF guard + timeouts. Don't grow `server/index.js`.
7. **Phase 2 — cart / quote.** Server-computed prices via the pricing util,
   quote IDs with expiry + immutable line snapshots. Never trust a client-sent
   price/total (the legacy bug).
   **Checkout tampering closed 2026-08-03:** the Stripe route now discards every browser-supplied
   name/price/total, re-resolves records from the configured catalog, validates package sizes, and builds
   itemized Stripe lines from server-owned cents. A durable expiring quote/order record is still a
   later feature; do not describe the whole phase as complete yet.
   **Plan checkout normalized 2026-08-03:** the two historical plan endpoints now produce the same
   one-time, server-priced credit pack. The client-controlled monthly/yearly subscription variant and
   its equal-price billing ambiguity were removed, and both pricing screens consume one client catalog
   that is contract-tested against the server catalog.
8. **Phase 3 — ordering.** Company-scoped orders, idempotency keys, audit on
   create/submit/cancel, PII handling. Confirm with Asinex whether they accept
   direct orders or only inquiries first.

## Tier 2 — Hardening & scale (bigger; some need infra)

9. **Stripe webhook in non-prod** *(real billing gap)*. Real purchases grant no
   credits because no webhook is registered off-prod. Register it, and/or add an
   admin-only manual-fulfill endpoint (audited) for testing. — infra + small code
10. **Redis-backed rate-limit + simulation-token state.** The in-memory limiter
   and token counters don't survive restarts or share across instances — this
   blocks horizontal scaling. Move to Redis before running >1 instance. — medium
   + infra
11. **Incrementally split `server/index.js`** (6,300+ lines). Extract one route
    family at a time into `server/routes/*` — start with the Asinex family we
    just touched. High maintainability payoff, low risk if done per-family with
    the suite green between extractions. — large but incremental
12. **Structured logging.** Replace `logToFile` (delete-on-rotate, loses history)
    with `pino` + archival. — medium
13. **Close the SSRF TOCTOU residual.** Current guard re-validates per request
    but can't pin the socket portably (Bun ignores undici dispatchers). A fixed
    egress allowlist/proxy in front of the ligand fetches would fully close it.
    — medium + infra

## Suggested order

Tier 0 first (cheap, item 1 is on a deadline). Then Tier 1 Phase 1 if stock is a
real product direction. Tier 2 items 9 (billing) and 10 (scaling) are the ones
with real production consequences — do them before a scale-up or real payments.
