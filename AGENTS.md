# Pyxis Discovery working instructions

## Mission and source of truth

Read [`GOAL.md`](GOAL.md) before proposing non-trivial work. The owner wants the maintained
frontend to remain recognizably Pyxis, deliver the best user experience, and make the Amsterdam
compute-box cutover simple. Do not grow that goal into a general rewrite.

Operational facts change faster than this file. Determine the current state in this order:

1. Resolve `app.pyxis-discovery.com` and inspect the working tree.
2. If DNS points at `oracleNew` (`84.13.81.51`), read
   [`docs/POST-PROMOTION-HANDOFF.md`](docs/POST-PROMOTION-HANDOFF.md) first.
3. Otherwise read [`docs/NEXT-SESSION.md`](docs/NEXT-SESSION.md) first.
4. For box work, then read [`docs/ARRIVAL-RUNBOOK.md`](docs/ARRIVAL-RUNBOOK.md) and
   [`docs/BOX-ARCHITECTURE.md`](docs/BOX-ARCHITECTURE.md).
5. Use [`docs/README.md`](docs/README.md) only as an index. Measure live state before
   trusting any dated status paragraph. After DNS → `84`, the handoff file above outranks
   older “`83` is production” prose anywhere else.

For architecture or file-relationship questions, query `graphify-out/graph.json` with the
`graphify` skill first. The graph can be stale; confirm changed code and operational state directly.

## Product invariants

- The product is **Pyxis Discovery**. `medsaas` is the repository name, not user-facing branding.
- “De-SaaS” means one-company Pyxis branding. It does **not** mean deleting signup, plans,
  purchasing, billing, roles, companies, credits, or other working product behavior.
- Preserve controls and flows users recognize. Fix how they work; do not remove or relocate them
  unless that is explicitly requested.
- Keep the existing signup/billing surface and scientific workflows. Do not add new tenant or
  billing features without a direct request.
- Reserve API `401` for an invalid/dead session because the client logs out on any `401`.
  Authorization failures are `403`, validation failures `400`, and upstream auth failures `502`.
- Credits are granted server-side from the Stripe webhook, never from the client.

## Architecture

- Bun workspace: `client/` is React 18 + Vite; `server/` is the Express/Bun API; `services/`
  contains scientific services and the MCP server; `deploy/` contains host and box deployment.
- Routes are primarily in `server/index.js`; scientific proxies also use
  `server/routes/scientificServices.js`.
- Client routes live in `client/src/routes.jsx`. Use `API_CONFIG.buildApiUrl()` for `/api/*` and
  `API_CONFIG.buildUrl()` for top-level routes.
- Authentication state comes from `client/src/context/auth.jsx`. Company branding and role checks
  are server-owned; do not trust client-only enforcement.
- MongoDB Atlas remains the production application database. Do not replace it with a local dump.
  Pyxis and FinSrv use separate Atlas projects.
- The Amsterdam box is compute-only: docking, DiffDock, conversion, Tanimoto/Postgres, GROMACS,
  ADMET, and glioblastoma. It does not receive the application API or MongoDB.
- Folding and molecule generation remain hosted NVIDIA services. Do not re-propose NVIDIA NIM / AI
  Enterprise for DiffDock; the selected replacement is OSS DiffDock.
- `oracleOld` (`151.145.91.17`) is a distinct host and temporary Tanimoto source. `oracleNew`
  (`84.13.81.51`) is the live application host (measure DNS). `83.229.87.94`: **scheduled for
  imminent shutdown** (owner 2026-08-21) — do not treat as long-lived standby; still measured up
  until teardown. Before-kill checklist and post-shutdown rollback question:
  [`docs/POST-PROMOTION-HANDOFF.md`](docs/POST-PROMOTION-HANDOFF.md).

## Working method

1. Restate the requested outcome, constraints, and stop point.
2. Inspect `git status`, the relevant code, and the current runbook/state file. Do not overwrite
   unrelated work in this often-dirty repository.
3. Give one short plan for non-trivial work, then execute it. Ask only for a decision that changes
   the product or for an authorization boundary.
4. Prefer the smallest change that solves the observed problem. Keep critical-path work separate
   from optional improvements.
5. Verify the actual affected surface. A build alone does not prove a dashboard flow works.
6. Stop when the requested outcome is met; state material remaining work without adopting it.

## Commands and focused verification

Use Bun by default. Root, `client/`, and `server/` intentionally keep Bun and npm lockfiles; after a
dependency change run `bun run lockfiles:refresh` and commit both families.

```bash
bun run dev               # API + Vite
bun run check             # server compile check + client build
bun run lint
bun run test              # server suite
bun run ci                # full repository gate
```

Choose checks by changed boundary:

- UI or routing: `bun run build` or `bun run check`, the nearest existing `test:*` lifecycle check,
  and one real browser/user path when feasible.
- Server/auth/billing: server compile check plus the nearest focused server test; use the full server
  suite when shared middleware or route plumbing changes.
- Branding: include `bun run test:brand`.
- Docking/box code: use its service-level tests and the real contract verifier documented in
  `docs/DOCKING-CONTRACT.md`; replay fixtures are not arrival evidence.
- Shared configuration, dependency, or release boundary: run `bun run ci` when its broader coverage
  is justified.

Do not stack several overlapping smoke tests around the same assertion. Inspect outputs critically;
loose grep counts and mocked fixtures have produced false confidence here.

## Git and release behavior

- Do not commit unless asked or the task explicitly includes shipping. After any commit, push it
  without asking; pushes run CI and do not deploy production.
- Production deployment is manual. Source upload, built `client/dist`, service restart, and deployed
  identity are separate concerns; follow the current runbook rather than reconstructing commands.
- Begin remote work with read-only identity, DNS, listener, service, build, and database checks.
- Obtain explicit approval immediately before a production mutation, DNS/network change, manual
  rollback, destructive cleanup, or removal of an old service/data source. Routine steps inside an
  approved deployment and documented automatic rollback do not need repeated approval.
- On shared hosts, never modify nginx, TLS, DNS, firewall, unrelated applications, or database
  volumes unless the user names and authorizes that exact action.
- Kill only measured PIDs or named units. Never use broad `pkill` patterns.
- Never print, copy into Git, or expose `.env` contents or credentials.

## Available project helpers

- Use the `pyxis-arrival` skill when the box arrives, when preparing its cutover, or when checking
  arrival readiness.
- Use `pyxis-api-route` when adding or changing Express `/api` routes, auth middleware, credit
  metering, proxies, or 401/403/502 behavior.
- Use `pyxis-feature-slice` when a product change needs client + server + the right test harness
  (includes gen-test guidance for `server/test` vs lifecycle scripts).
- Use the Pyxis operations custom agent (`pyxis_ops` in Codex, `pyxis-ops` in Claude) only for a
  read-only topology, runbook, deployment-risk, or live identity audit. Do not spawn it for ordinary
  one-file work.
