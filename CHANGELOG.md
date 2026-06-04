# Changelog

## v2 — Bun Migration (in progress)

### Phase 5 — Server Runtime on Bun

- Express API now runs on the **Bun** runtime by default in dev and production
  (`bun index.js` / `bun --watch index.js`), with npm retained as the script runner.
- Stripe webhook migrated to `constructEventAsync` for Bun WebCrypto compatibility
  (behavior-identical to the sync path; valid/forged signature handling unchanged).
- Runtime parity smoke tests pass 13/13 under both Node and Bun; `bun --watch` reload verified.
- One-command **Node rollback** aliases preserved at server and root level (`*:node`).
- RSS/startup measured on oracle Linux (N=5, `/proc` VmRSS): Bun idle RSS 115.1 MiB vs the
  locked 118.9 MiB Phase 4 baseline → gate **PASS**, Bun stays default. On the same host Node
  measured 115.5 MiB — Bun is at parity with Node, not a memory win. See
  `.planning/phases/05-server-runtime-on-bun/BUN-BEFORE-AFTER.md`.
