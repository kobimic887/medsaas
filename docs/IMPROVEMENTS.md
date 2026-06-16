# Improvement Backlog

Prioritized, do-later plan. Drawn from this session's work (Asinex RE, the SSRF/
timeout/CI fixes) and `.planning/codebase/CONCERNS.md`. Effort is rough; risk is
"chance of breaking something live."

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
   that fails the run. **Ratchet later:** the relaxed `error`→`warn` rules each
   want a dedicated fix pass before being restored to `error` —
   - a11y group (`useKeyWithClickEvents` ×16, `noLabelWithoutControl` ×15,
     `noSvgWithoutTitle` ×14, `useButtonType` ×6, `useValidAnchor` ×5, …): a
     real accessibility cleanup of the client.
   - dead code (`noUnusedVariables` ×59, `noUnusedImports` ×50,
     `noUnusedFunctionParameters` ×23): safe to remove incrementally, but
     server-side side-effect imports and positional params need eyes-on.
   - `noInnerDeclarations` ×3 / `useIterableCallbackReturn` ×1: localized
     correctness smells (a `var`→`let` scope change in the DiffDock route; a
     render `.map` with a non-returning branch) — fix with care, not autofix.
   The Node leg (`ci:node`) intentionally does not re-run lint — runtime-
   independent, one run is enough.
4. **Client price-display consistency.** In `simulation.jsx`, `PRICE_2MG` has a
   `|| "N/A"` fallback the other weights lack — make them uniform. Trivial. —
   `client/src/pages/dashboard/simulation.jsx`
   **Completed 2026-06-14:** removed the truthy fallback so a missing 2 mg
   price behaves like the other weights and cannot expose an invalid cart action.

## Tier 1 — Asinex stock feature (continues today's RE; medium)

Builds directly on `server/utils/asinexCompound.js` (pricing + normalizer) and
`docs/ASINEX-ESHOP-REVERSE-ENGINEERING.md`.

5. **Phase 1 — read-only stock.** New `server/services/asinex/` module: a stock
   search client that honours the **async substructure flow** (fire search →
   poll `ReCheckQuery` by `requestid` → fetch), reuses the normalizer, and has
   contract tests against saved/sanitised fixtures. Keep behind the existing
   SSRF guard + timeouts. Don't grow `server/index.js`.
6. **Phase 2 — cart / quote.** Server-computed prices via the pricing util,
   quote IDs with expiry + immutable line snapshots. Never trust a client-sent
   price/total (the legacy bug).
7. **Phase 3 — ordering.** Company-scoped orders, idempotency keys, audit on
   create/submit/cancel, PII handling. Confirm with Asinex whether they accept
   direct orders or only inquiries first.

## Tier 2 — Hardening & scale (bigger; some need infra)

8. **Stripe webhook in non-prod** *(real billing gap)*. Real purchases grant no
   credits because no webhook is registered off-prod. Register it, and/or add an
   admin-only manual-fulfill endpoint (audited) for testing. — infra + small code
9. **Redis-backed rate-limit + simulation-token state.** The in-memory limiter
   and token counters don't survive restarts or share across instances — this
   blocks horizontal scaling. Move to Redis before running >1 instance. — medium
   + infra
10. **Incrementally split `server/index.js`** (6,300+ lines). Extract one route
    family at a time into `server/routes/*` — start with the Asinex family we
    just touched. High maintainability payoff, low risk if done per-family with
    the suite green between extractions. — large but incremental
11. **Structured logging.** Replace `logToFile` (delete-on-rotate, loses history)
    with `pino` + archival. — medium
12. **Close the SSRF TOCTOU residual.** Current guard re-validates per request
    but can't pin the socket portably (Bun ignores undici dispatchers). A fixed
    egress allowlist/proxy in front of the ligand fetches would fully close it.
    — medium + infra

## Suggested order

Tier 0 first (cheap, item 1 is on a deadline). Then Tier 1 Phase 1 if stock is a
real product direction. Tier 2 items 8 (billing) and 9 (scaling) are the ones
with real production consequences — do them before a scale-up or real payments.
